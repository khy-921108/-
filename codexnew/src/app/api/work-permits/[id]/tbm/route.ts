import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/equipment';
import { evaluateParticipant } from '@/lib/participant-eligibility';
import { evaluateRequiredDocs } from '@/lib/safety-doc-status';
import { sendSms } from '@/lib/sms';
import { isValidSignature, isValidPhoto, MAX_PHOTO_BYTES } from '@/lib/upload-validate';

export const runtime = 'nodejs';
export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // 무한 대기 방지

const DB_TIMEOUT_MS = 15000; // 현장 업로드는 조금 여유
function withTimeout<T>(p: PromiseLike<T>, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT:${label}`)), DB_TIMEOUT_MS)),
  ]);
}

/**
 * POST /api/work-permits/:id/tbm  (공개, 본인확인 게이트) — R-6 게이트③-6
 * 업체(신청자)가 현장에서 TBM 사진 업로드 + 작업자 돌려서명. 안전환경은 여기 안 올림.
 *
 * body.action:
 *  - 'session' : 본인확인 후 TBM 상태·참여자 명단(전화 미노출) 반환
 *  - 'photo'   : 현장 사진 1장 업로드(비공개 버킷, 최대 2장)
 *  - 'confirm' : 참여자 1명 서명 기록(돌려서명) → tbm.confirmations
 *  - 'submit'  : TBM 제출 표식 + 안전환경 담당 알림(best-effort)
 *
 * 보안: 요청자(name·birthDate·phone)가 이 허가서의 "신청자"와 일치할 때만 허용(남의 허가서 차단).
 *       1차 승인(issuer_signature) 전에는 사진/서명/제출 불가.
 */
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const permitId = ctx.params.id;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, code: 'BAD_REQUEST', message: '잘못된 요청입니다.' }, { status: 400 });
  }

  const name = (body?.name ?? '').toString().trim();
  const birthDate = (body?.birthDate ?? '').toString().trim();
  const phone = (body?.phone ?? '').toString().replace(/[^0-9]/g, '');
  const action = body?.action;

  if (!name || !birthDate || phone.length < 10) {
    return NextResponse.json({ success: false, code: 'INVALID_INPUT', message: '본인확인 정보를 정확히 입력해 주세요.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  try {
  const { data: permit, error } = await withTimeout(
    supabase
      .from('work_permits')
      .select('id, permit_number, work_name, status, applicant_name, applicant_birth_date, applicant_phone, issuer_signature, tbm, started_at, work_end, completion, supplemental, field_joins, equipment_arrivals, request_company_name, request_company_id')
      .eq('id', permitId)
      .maybeSingle(),
    'select'
  );

  if (error) {
    console.error('[tbm] read:', error);
    return NextResponse.json({ success: false, code: 'QUERY_FAILED', message: '조회 오류' }, { status: 500 });
  }
  if (!permit) {
    return NextResponse.json({ success: false, code: 'NOT_FOUND', message: '작업허가를 찾을 수 없습니다.' }, { status: 404 });
  }

  // 신청자 본인 매칭(이름+생년월일+정규화 전화)
  const isApplicant =
    (permit.applicant_name ?? '').trim() === name &&
    (permit.applicant_birth_date ?? '') === birthDate &&
    normalizePhone(permit.applicant_phone) === normalizePhone(phone);
  if (!isApplicant) {
    return NextResponse.json(
      { success: false, code: 'NOT_APPLICANT', message: '본인이 신청한 작업허가만 현장 TBM을 진행할 수 있습니다.' },
      { status: 403 }
    );
  }

  const tbm = (permit.tbm ?? {}) as Record<string, any>;
  const issued = !!(permit.issuer_signature && String(permit.issuer_signature).startsWith('data:image/'));
  const photos: string[] = Array.isArray(tbm.photos) ? tbm.photos : [];
  const confirmations: Record<string, any> = tbm.confirmations ?? {};

  // 참여자 명단(전화는 서버 내부 매칭용, 클라 미노출)
  const { data: parts } = await withTimeout(
    supabase
      .from('work_permit_participants')
      .select('name, phone, company_name, sort_order')
      .eq('work_permit_id', permitId)
      .order('sort_order', { ascending: true }),
    'participants'
  );
  const roster = (parts ?? []).map((p: any) => {
    const key = `${(p.name ?? '').trim()}||${normalizePhone(p.phone)}`;
    return { name: p.name, companyName: p.company_name, confirmed: !!confirmations[key]?.signature };
  });

  const compTbm = (permit.completion ?? {}) as Record<string, any>;
  const isSigStr = (s: any) => !!(s && String(s).startsWith('data:image/'));
  const suppTbm = (permit.supplemental ?? {}) as Record<string, string>;
  const arrivals: any[] = Array.isArray(permit.equipment_arrivals) ? permit.equipment_arrivals : [];
  const fieldJoins: any[] = Array.isArray(permit.field_joins) ? permit.field_joins : [];

  // ── session: 상태만 반환 ──
  if (action === 'session') {
    return NextResponse.json({
      success: true,
      data: {
        permitNumber: permit.permit_number,
        workName: permit.work_name,
        status: permit.status,
        issued,
        photoCount: photos.length,
        maxPhotos: 2,
        roster,
        tbmSubmitted: !!tbm.tbmSubmittedAt, // 제출 완료 여부
        witnessConfirmed: !!(tbm.witness?.signature && String(tbm.witness.signature).startsWith('data:image/')), // 2차 입회 완료
        started: !!permit.started_at,
        reported: isSigStr(compTbm.workerSignature),   // 종료신고 완료(합류자 추가 불가)
        closed: isSigStr(compTbm.confirmSignature),    // 종료확인 완료(장비 도착 등록 불가)
        heavyOrExcav: suppTbm.heavy === 'Y' || suppTbm.excavation === 'Y', // 장비 도착 버튼 표시 여부
        arrivals: arrivals.map((a: any) => ({ type: a.type, vehicleNumber: a.vehicleNumber ?? '', at: a.at })),
        joinCount: fieldJoins.length,
      },
    });
  }

  // 사진/서명/제출은 1차 승인 후에만
  if (!issued) {
    return NextResponse.json(
      { success: false, code: 'NOT_ISSUED', message: '안전환경 1차 승인 후 현장 TBM을 진행할 수 있습니다.' },
      { status: 409 }
    );
  }

  // 🔴 개시 후 TBM 변경 차단(사진·서명·제출). 개시 전에는 자유.
  if (['photo', 'confirm', 'submit'].includes(action) && permit.started_at) {
    return NextResponse.json(
      { success: false, code: 'ALREADY_STARTED', message: '작업이 개시되어 TBM을 변경할 수 없습니다.' },
      { status: 409 }
    );
  }

  // ── photo: 사진 1장 업로드 ──
  if (action === 'photo') {
    const image = (body?.image ?? '').toString();
    // 보안검토②: png/jpeg/webp만 허용(svg 등 차단) + 장수·용량 상한.
    if (!isValidPhoto(image)) return NextResponse.json({ success: false, code: 'BAD_IMAGE', message: '지원하지 않는 이미지 형식입니다(PNG·JPG·WEBP만 허용).' }, { status: 400 });
    if (photos.length >= 2) return NextResponse.json({ success: false, code: 'PHOTO_FULL', message: '사진은 최대 2장까지입니다.' }, { status: 409 });
    const m = image.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/)!;
    const mime = m[1] === 'jpg' ? 'jpeg' : m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_PHOTO_BYTES) return NextResponse.json({ success: false, code: 'TOO_LARGE', message: '사진 용량이 큽니다(5MB 이하로 업로드).' }, { status: 413 });
    const ext = mime === 'jpeg' ? 'jpg' : mime;
    const key = `permits/${permitId}/tbm-${Date.now()}.${ext}`;
    const { error: upErr } = await withTimeout(
      supabase.storage.from('work-permit-photos').upload(key, buf, { contentType: `image/${mime}`, upsert: true }),
      'upload'
    );
    if (upErr) {
      console.error('[tbm] photo upload:', upErr);
      return NextResponse.json({ success: false, code: 'UPLOAD_FAILED', message: '사진 업로드 실패' }, { status: 500 });
    }
    const nextPhotos = [...photos, key];
    const { error: patchErr } = await withTimeout(supabase.from('work_permits').update({ tbm: { ...tbm, photos: nextPhotos } }).eq('id', permitId), 'photo-save');
    if (patchErr) return NextResponse.json({ success: false, code: 'SAVE_FAILED', message: '저장 실패' }, { status: 500 });
    return NextResponse.json({ success: true, data: { photoCount: nextPhotos.length } });
  }

  // ── confirm: 참여자 돌려서명 ──
  if (action === 'confirm') {
    const target = (body?.participantName ?? '').toString().trim();
    const signature = (body?.signature ?? '').toString();
    if (!isValidSignature(signature)) return NextResponse.json({ success: false, code: 'NO_SIGNATURE', message: '서명이 올바르지 않습니다(PNG 서명 필요).' }, { status: 400 });
    const p = (parts ?? []).find((x: any) => (x.name ?? '').trim() === target);
    if (!p) return NextResponse.json({ success: false, code: 'NOT_PARTICIPANT', message: '참여자 명단에 없는 사람입니다.' }, { status: 400 });
    const norm = normalizePhone(p.phone);
    const key = `${(p.name ?? '').trim()}||${norm}`;
    const nextConfs = { ...confirmations, [key]: { name: p.name, signature, confirmedAt: new Date().toISOString() } };
    const { error: cErr } = await withTimeout(supabase.from('work_permits').update({ tbm: { ...tbm, confirmations: nextConfs } }).eq('id', permitId), 'confirm-save');
    if (cErr) return NextResponse.json({ success: false, code: 'SAVE_FAILED', message: '저장 실패' }, { status: 500 });
    const confirmedCount = Object.values(nextConfs).filter((c: any) => c?.signature).length;
    return NextResponse.json({ success: true, data: { confirmedCount, total: roster.length } });
  }

  // ── submit: 제출 표식 + 안전환경 알림 ──
  if (action === 'submit') {
    // ③: 빈 TBM 제출 차단(프론트 우회 방지) — 사진 ≥1 + 참여자 전원 서명 + 개시 전 + 작업일 이내.
    if (permit.started_at) {
      return NextResponse.json({ success: false, code: 'ALREADY_STARTED', message: '이미 작업이 개시되어 TBM 제출을 할 수 없습니다.' }, { status: 409 });
    }
    const p2 = (n: number) => String(n).padStart(2, '0');
    const kstYmd = (ms: number) => { const k = new Date(ms + 9 * 3600 * 1000); return `${k.getUTCFullYear()}-${p2(k.getUTCMonth() + 1)}-${p2(k.getUTCDate())}`; };
    if (permit.work_end && kstYmd(new Date(permit.work_end).getTime()) < kstYmd(Date.now())) {
      return NextResponse.json({ success: false, code: 'WORK_DAY_PASSED', message: '작업일이 지난 허가서입니다. 새로 신청해 주세요.' }, { status: 400 });
    }
    const isSig = (s: any) => !!(s && String(s).startsWith('data:image/'));
    const signedCount = Object.values(confirmations).filter((c: any) => isSig(c?.signature)).length;
    const total = (parts ?? []).length;
    if (photos.length < 1 || signedCount < total) {
      return NextResponse.json({ success: false, code: 'TBM_INCOMPLETE', message: `TBM 미완료: 사진 ${photos.length}/1, 서명 ${signedCount}/${total}명` }, { status: 400 });
    }
    const alreadySubmitted = !!tbm.tbmSubmittedAt; // 이미 제출됨 → 문자 재발송 금지(감사 발견3)
    const nextTbm = { ...tbm, tbmSubmittedAt: tbm.tbmSubmittedAt ?? new Date().toISOString(), tbmSubmittedBy: name };
    const { error: sErr } = await withTimeout(supabase.from('work_permits').update({ tbm: nextTbm }).eq('id', permitId), 'submit-save');
    if (sErr) return NextResponse.json({ success: false, code: 'SAVE_FAILED', message: '저장 실패' }, { status: 500 });
    if (!alreadySubmitted) {
      try {
        const managerPhone = process.env.SOLAPI_SENDER;
        if (managerPhone) {
          const sms = await sendSms(managerPhone, `[동남] 현장 TBM 완료 ${permit.permit_number} — 2차(입회) 확인 요청`);
          if (!sms.ok) console.error('[tbm] notify sms failed:', sms.code, sms.message);
        }
      } catch (e) {
        console.error('[tbm] notify sms unexpected:', e);
      }
    }
    return NextResponse.json({ success: true, data: { submitted: true, resent: false } });
  }

  // ── join: 현장 합류자 추가 (append 전용 — 개시 후에도 가능, 종료신고 후 불가) ──
  //  기존 기록 수정·삭제 잠금과 별개: 참여자·서명·합류기록을 "추가"만 한다.
  // 작업일 경과 판정(join·arrival 공용 — submit 과 동일 규칙)
  const p2g = (n: number) => String(n).padStart(2, '0');
  const kstYmdG = (ms: number) => { const k = new Date(ms + 9 * 3600 * 1000); return `${k.getUTCFullYear()}-${p2g(k.getUTCMonth() + 1)}-${p2g(k.getUTCDate())}`; };
  const workDayPassed = !!permit.work_end && kstYmdG(new Date(permit.work_end).getTime()) < kstYmdG(Date.now());

  if (action === 'join') {
    if (isSigStr(compTbm.workerSignature) || isSigStr(compTbm.confirmSignature)) {
      return NextResponse.json({ success: false, code: 'ALREADY_REPORTED', message: '종료신고 이후에는 합류자를 추가할 수 없습니다.' }, { status: 409 });
    }
    // (J-3) 작업일 경과 시 합류 불가 — submit 과 동일 규칙
    if (workDayPassed) {
      return NextResponse.json({ success: false, code: 'WORK_DAY_PASSED', message: '작업일이 지난 허가서입니다. 새로 신청해 주세요.' }, { status: 400 });
    }
    const jName = (body?.joinName ?? '').toString().trim();
    const jBirth = (body?.joinBirthDate ?? '').toString().trim();
    const jPhone = (body?.joinPhone ?? '').toString().replace(/[^0-9]/g, '');
    const jSig = (body?.signature ?? '').toString();
    if (!jName || !jBirth || jPhone.length < 10) {
      return NextResponse.json({ success: false, code: 'INVALID_INPUT', message: '합류자의 이름·생년월일·연락처를 정확히 입력해 주세요.' }, { status: 400 });
    }
    // 이미 참여자인지(이름+정규화 전화) 확인
    const jNorm = normalizePhone(jPhone);
    const dup = (parts ?? []).some((p: any) => (p.name ?? '').trim() === jName && normalizePhone(p.phone) === jNorm);
    if (dup) {
      return NextResponse.json({ success: false, code: 'ALREADY_PARTICIPANT', message: '이미 참여자 명단에 있는 사람입니다.' }, { status: 409 });
    }
    // 교육 수료 확인(기존 판정 재사용 — 작업 종료일 기준)
    const elig = await withTimeout(evaluateParticipant(supabase, { name: jName, birthDate: jBirth, phone: jPhone }, permit.work_end), 'eligibility');
    if (elig.status !== 'VALID') {
      return NextResponse.json(
        { success: false, code: 'NOT_ELIGIBLE', message: '안전교육을 먼저 받아야 합니다. (수료 없음 또는 작업일 기준 만료)' },
        { status: 403 }
      );
    }
    // (J-1) 필수서류(개인서약·이행각서) — 신청 경로와 동일 검증
    let docsResult: any = null;
    try {
      docsResult = await withTimeout(
        evaluateRequiredDocs(supabase, {
          companyId: permit.request_company_id ?? '',
          participants: [{ name: jName, birthDate: jBirth, phone: jPhone }],
          workEnd: permit.work_end,
        }),
        'docs'
      );
    } catch (e) {
      console.error('[tbm join] docs check:', e);
      return NextResponse.json({ success: false, code: 'DOCS_CHECK_FAILED', message: '필수서류 확인 중 오류가 발생했습니다.' }, { status: 500 });
    }
    const pledgeOk = docsResult.pledges?.[0]?.status === 'VALID';
    const undertakingOk = docsResult.undertaking?.status === 'VALID';
    const docsMissing: string[] = [];
    if (!pledgeOk) docsMissing.push('개인 안전준수 서약');
    if (!undertakingOk) docsMissing.push(docsResult.undertaking?.status === 'STALE_MEMBERS' ? '이행각서 명단 추가' : '업체 이행각서');

    // 1단계(확인만): 수료·소속 + 서류 미비 여부 반환(저장 안 함)
    if (body?.checkOnly === true) {
      return NextResponse.json({
        success: true,
        data: {
          eligible: true, name: jName, companyName: elig.companyName, targetLabel: elig.targetLabel, expiresAt: elig.expiresAt,
          docsOk: docsMissing.length === 0,
          docsMissing,
          pledgeOk,
          undertakingStatus: docsResult.undertaking?.status ?? 'MISSING',
          undertakingManagerName: docsResult.undertaking?.managerName ?? null,
          companyId: permit.request_company_id ?? null,
        },
      });
    }
    // 미비 시 403 — 화면에서 그 자리 처리 후 재시도
    if (docsMissing.length > 0) {
      return NextResponse.json(
        { success: false, code: 'DOCS_REQUIRED', message: `필수서류 미비: ${docsMissing.join(', ')}. 작성 후 다시 시도해 주세요.`, data: { docsMissing } },
        { status: 403 }
      );
    }
    if (body?.briefed !== true) {
      return NextResponse.json({ success: false, code: 'NOT_BRIEFED', message: '위험요인·안전대책 설명 확인이 필요합니다.' }, { status: 400 });
    }
    if (!isValidSignature(jSig)) {
      return NextResponse.json({ success: false, code: 'NO_SIGNATURE', message: '합류자 서명이 필요합니다(PNG).' }, { status: 400 });
    }
    const now = new Date().toISOString();
    // 1) 참여자 추가(소속·장비정보 자동) — 전원 서명 판정·출력에 자동 포함
    const maxSort = (parts ?? []).length;
    const { error: insErr } = await withTimeout(
      supabase.from('work_permit_participants').insert({
        work_permit_id: permitId,
        session_id: elig.sessionId,   // (J-2) eligibility 결과값
        company_id: elig.companyId,
        name: jName,
        phone: jPhone,
        company_name: elig.companyName ?? permit.request_company_name,
        target_type: elig.targetCode,
        vehicle_number: elig.vehicleNumber,
        equipment_type: elig.equipmentType,
        spec: elig.spec,
        completed_at: elig.completedAt,
        expires_at: elig.expiresAt,
        sort_order: maxSort + 1,
      }),
      'join-insert'
    );
    if (insErr) {
      console.error('[tbm join] participant insert:', insErr);
      return NextResponse.json({ success: false, code: 'SAVE_FAILED', message: '합류자 저장 실패' }, { status: 500 });
    }
    // 2) 추가 TBM 서명(돌려서명과 동일 키) + 3) 합류 기록 append(시각)
    const key = `${jName}||${jNorm}`;
    const nextConfs = { ...confirmations, [key]: { name: jName, signature: jSig, confirmedAt: now } };
    const nextJoins = [...fieldJoins, { name: jName, phone: jNorm, companyName: elig.companyName ?? permit.request_company_name, targetLabel: elig.targetLabel, joinedAt: now }];
    const { error: jErr } = await withTimeout(
      supabase.from('work_permits').update({ tbm: { ...tbm, confirmations: nextConfs }, field_joins: nextJoins }).eq('id', permitId),
      'join-save'
    );
    if (jErr) {
      console.error('[tbm join] save:', jErr);
      return NextResponse.json({ success: false, code: 'SAVE_FAILED', message: '합류 기록 저장 실패' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data: { joined: true, name: jName, joinedAt: now, companyName: elig.companyName } });
  }

  // ── arrival: 장비 도착 등록 (사진 필수 — 개시 후에도 가능, 종료확인 후 불가) ──
  if (action === 'arrival') {
    if (isSigStr(compTbm.confirmSignature)) {
      return NextResponse.json({ success: false, code: 'ALREADY_CLOSED', message: '종료확인 이후에는 장비 도착을 등록할 수 없습니다.' }, { status: 409 });
    }
    // (A-1) 중장비·굴착 허가서에만 허용
    if (suppTbm.heavy !== 'Y' && suppTbm.excavation !== 'Y') {
      return NextResponse.json({ success: false, code: 'NOT_APPLICABLE', message: '장비 도착 등록은 중장비·굴착 허가서에서만 가능합니다.' }, { status: 400 });
    }
    // (J-3) 작업일 경과 시 등록 불가
    if (workDayPassed) {
      return NextResponse.json({ success: false, code: 'WORK_DAY_PASSED', message: '작업일이 지난 허가서입니다. 새로 신청해 주세요.' }, { status: 400 });
    }
    // (A-2) 등록 건수 상한
    if (arrivals.length >= 20) {
      return NextResponse.json({ success: false, code: 'TOO_MANY', message: '장비 도착 등록은 최대 20건까지입니다.' }, { status: 400 });
    }
    const aType = (body?.equipType ?? '').toString().trim();
    const aVehicle = (body?.vehicleNumber ?? '').toString().trim();
    const image = (body?.image ?? '').toString();
    if (!aType) {
      return NextResponse.json({ success: false, code: 'NO_TYPE', message: '장비 종류를 입력해 주세요.' }, { status: 400 });
    }
    if (!isValidPhoto(image)) {
      return NextResponse.json({ success: false, code: 'BAD_IMAGE', message: '장비 사진이 필요합니다(PNG·JPG·WEBP만 허용).' }, { status: 400 });
    }
    const m = image.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/)!;
    const mime = m[1] === 'jpg' ? 'jpeg' : m[1];
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_PHOTO_BYTES) {
      return NextResponse.json({ success: false, code: 'TOO_LARGE', message: '사진 용량이 큽니다(5MB 이하).' }, { status: 413 });
    }
    const ext = mime === 'jpeg' ? 'jpg' : mime;
    const key = `permits/${permitId}/arrival-${Date.now()}.${ext}`;
    const { error: upErr } = await withTimeout(
      supabase.storage.from('work-permit-photos').upload(key, buf, { contentType: `image/${mime}`, upsert: true }),
      'arrival-upload'
    );
    if (upErr) {
      console.error('[tbm arrival] upload:', upErr);
      return NextResponse.json({ success: false, code: 'UPLOAD_FAILED', message: '사진 업로드 실패' }, { status: 500 });
    }
    const now = new Date().toISOString();
    const nextArrivals = [...arrivals, { type: aType, vehicleNumber: aVehicle || null, photo: key, at: now }];
    const { error: aErr } = await withTimeout(
      supabase.from('work_permits').update({ equipment_arrivals: nextArrivals }).eq('id', permitId),
      'arrival-save'
    );
    if (aErr) {
      console.error('[tbm arrival] save:', aErr);
      return NextResponse.json({ success: false, code: 'SAVE_FAILED', message: '도착 기록 저장 실패' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data: { arrived: true, at: now, count: nextArrivals.length } });
  }

  return NextResponse.json({ success: false, code: 'BAD_ACTION', message: '알 수 없는 동작입니다.' }, { status: 400 });
  } catch (e) {
    const msg = (e as Error)?.message ?? '';
    console.error('[tbm] fatal:', msg);
    const timeout = msg.startsWith('TIMEOUT');
    return NextResponse.json(
      { success: false, code: timeout ? 'TIMEOUT' : 'SERVER_ERROR', message: timeout ? '처리가 지연되었습니다. 잠시 후 다시 시도해 주세요.' : '서버 오류가 발생했습니다.' },
      { status: timeout ? 504 : 500 }
    );
  }
}
