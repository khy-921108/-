import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { evaluateParticipant } from '@/lib/participant-eligibility';
import { generateWorkPermitNumber } from '@/lib/work-permit-number';
import { SUPPLEMENTAL_KEYS } from '@/lib/work-permit-constants';
import { evaluateRequiredDocs } from '@/lib/safety-doc-status';
import { sendSms } from '@/lib/sms';
import { isValidSignature, isValidPhoto } from '@/lib/upload-validate';

export const runtime = 'nodejs';

/**
 * POST /api/work-permits  (공개) — 제출
 * - 모든 참여자를 **서버에서 작업종료일 기준 재검증**(클라 'valid' 신뢰 금지).
 *   하나라도 VALID 아니면 403 PARTICIPANT_NOT_ELIGIBLE(누구인지 반환).
 * - 신청번호 RPC 원자 발급 + UNIQUE 백스톱 + 충돌 ≤3회 재시도.
 * - work_permits + participants 스냅샷(이름·업체명·차량·유효기간) INSERT.
 * - 안전조치 16항목은 수집하지 않음(현장 빈칸).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const companyId =
      typeof body.companyId === 'string' && body.companyId.trim() ? body.companyId.trim() : null;
    const info = body.info ?? {};
    const supplementalIn = body.supplemental ?? {};
    const participantsIn: any[] = Array.isArray(body.participants) ? body.participants : [];
    // ---- R-6: 승인/서명/TBM 상세 입력 ----
    const approvalIn = body.approval ?? {};
    const tbmDetailIn = body.tbmDetail ?? {};
    const signaturesIn = body.signatures ?? {};
    const photosIn: string[] = Array.isArray(body.photos) ? body.photos : [];
    const approverName = (approvalIn.approverName ?? '').trim() || null;
    const approverTitle = (approvalIn.approverTitle ?? '').trim() || null;
    const approvalMode = approvalIn.approvalMode === 'SITE' || approvalIn.approvalMode === 'REMOTE'
      ? approvalIn.approvalMode
      : null;
    const applicantSignature = isValidSignature(signaturesIn.applicant) ? signaturesIn.applicant : null;
    const safetyManagerSignature = isValidSignature(signaturesIn.safetyManager) ? signaturesIn.safetyManager : null;
    const asStrArray = (v: any): string[] =>
      Array.isArray(v) ? v.map((x) => (x ?? '').toString()).filter((s) => s.trim()) : [];

    // ---- 1. 필수값 검증 ----
    const workName = (info.workName ?? '').trim();
    const workLocation = (info.workLocation ?? '').trim();
    const workContent = (info.workContent ?? '').trim();
    const applicantName = (info.applicantName ?? '').trim();
    const applicantPhone = (info.applicantPhone ?? '').replace(/[^0-9]/g, '');
    const applicantTitle = (info.applicantTitle ?? '').trim() || null;
    const applicantBirthDate = (info.applicantBirthDate ?? '').trim() || null;
    const equipmentNo = (info.equipmentNo ?? '').trim() || null;
    const workStart = info.workStart;
    const workEnd = info.workEnd;

    if (!companyId || !workName || !workLocation || !workContent || !applicantName || !applicantPhone) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '필수 작업정보가 누락되었습니다.' },
        { status: 400 }
      );
    }
    const startTs = new Date(workStart).getTime();
    const endTs = new Date(workEnd).getTime();
    if (isNaN(startTs) || isNaN(endTs)) {
      return NextResponse.json(
        { success: false, code: 'INVALID_PERIOD', message: '작업일시 형식이 올바르지 않습니다.' },
        { status: 400 }
      );
    }
    if (startTs >= endTs) {
      return NextResponse.json(
        { success: false, code: 'INVALID_PERIOD', message: '작업 종료일시가 시작일시보다 빠를 수 없습니다.' },
        { status: 400 }
      );
    }
    // 매일발급 A안: 허가서는 하루 단위만 — 시작·종료 날짜(KST)가 다르면 거부.
    //  (기존 기간 허가서는 과거 기록으로 유지, 새 신청부터 적용)
    const kstDate = (iso: string) => {
      const k = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`;
    };
    if (kstDate(workStart) !== kstDate(workEnd)) {
      return NextResponse.json(
        { success: false, code: 'INVALID_PERIOD', message: '작업허가는 하루 단위만 신청할 수 있습니다. 작업 시작·종료 날짜가 같아야 합니다.' },
        { status: 400 }
      );
    }
    if (participantsIn.length === 0) {
      return NextResponse.json(
        { success: false, code: 'NO_PARTICIPANT', message: '참여자를 최소 1명 추가해 주세요.' },
        { status: 400 }
      );
    }
    // 🔴 신청인(현장소장) 서명 필수 — 서명 없으면 제출 불가.
    if (!applicantSignature) {
      return NextResponse.json(
        { success: false, code: 'SIGNATURE_REQUIRED', message: '신청인(현장소장) 서명이 필요합니다. 서명 후 제출해 주세요.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // ---- 2. 업체 확인(스냅샷용 이름) ----
    const { data: company, error: compErr } = await supabase
      .from('companies')
      .select('id, name, status')
      .eq('id', companyId)
      .maybeSingle();
    if (compErr) {
      console.error('[work-permits POST] company:', compErr);
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: '업체 확인 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }
    if (!company) {
      return NextResponse.json(
        { success: false, code: 'COMPANY_NOT_FOUND', message: '작업요청 업체를 찾을 수 없습니다.' },
        { status: 400 }
      );
    }
    if (company.status === 'DISABLED') {
      return NextResponse.json(
        { success: false, code: 'COMPANY_DISABLED', message: '사용이 중지된 업체입니다.' },
        { status: 400 }
      );
    }

    // ---- 3. 참여자 서버 재검증 (작업종료일 기준) ----
    const evaluated = [];
    const invalid: { name: string; status: string }[] = [];
    for (const p of participantsIn) {
      const name = (p?.name ?? '').trim();
      const birthDate = (p?.birthDate ?? '').trim();
      const phone = (p?.phone ?? '').replace(/[^0-9]/g, '');
      if (!name || !birthDate || !phone) {
        invalid.push({ name: name || '(이름없음)', status: 'INVALID_INPUT' });
        continue;
      }
      const r = await evaluateParticipant(supabase, { name, birthDate, phone }, workEnd);
      if (r.status !== 'VALID') {
        invalid.push({ name, status: r.status });
      } else {
        evaluated.push(r);
      }
    }

    if (invalid.length > 0) {
      return NextResponse.json(
        {
          success: false,
          code: 'PARTICIPANT_NOT_ELIGIBLE',
          message: '교육이 작업일 기준 만료되었거나 수료 정보가 없는 참여자가 있습니다.',
          data: { invalid },
        },
        { status: 403 }
      );
    }

    // ---- 3.4 중장비·장비 검증 (프론트 우회 방지) ----
    //  중장비(heavy) 체크인데 HEAVY 교육 수료 참여자 0명 → 거부.
    const heavyChecked = supplementalIn?.heavy === 'Y';
    const heavyParts = evaluated.filter((e: any) => e.targetCode === 'HEAVY');
    if (heavyChecked && heavyParts.length === 0) {
      return NextResponse.json(
        { success: false, code: 'NO_HEAVY_OPERATOR', message: '중장비 작업에는 중장비 교육을 수료한 기사가 1명 이상 필요합니다.' },
        { status: 400 }
      );
    }
    // 장비 스냅샷 — 차량번호 대조는 서버가 재계산(클라 matched 불신).
    const normPlate = (s: any) => (typeof s === 'string' ? s.replace(/[\s-]/g, '').toUpperCase() : '');
    const heavyPlates = heavyParts.map((e: any) => normPlate(e.vehicleNumber)).filter(Boolean);
    const equipment = (Array.isArray(body.equipment) ? body.equipment : [])
      .map((e: any) => ({ type: (e?.type ?? '').toString().trim(), vehicleNumber: (e?.vehicleNumber ?? '').toString().trim() }))
      .filter((e: any) => e.type || e.vehicleNumber)
      .slice(0, 20)
      .map((e: any) => ({ ...e, matched: !!normPlate(e.vehicleNumber) && heavyPlates.includes(normPlate(e.vehicleNumber)) }));
    // ②: 중장비 체크인데 장비 정보가 하나도 없으면 거부(프론트 우회 방지).
    if (heavyChecked && equipment.length === 0) {
      return NextResponse.json(
        { success: false, code: 'NO_EQUIPMENT', message: '중장비 작업은 장비 정보(종류·차량번호)를 1개 이상 입력해야 합니다.' },
        { status: 400 }
      );
    }

    // ---- 3.5 필수서류(1C-2) 서버 재검증 (작업종료일 기준) ----
    //  각 참여자 유효 개인서약 + 업체 유효 이행각서(모든 참여자 커버). 클라 'docs 완료' 불신.
    const docPersons = participantsIn.map((p: any) => ({
      name: (p?.name ?? '').trim(),
      birthDate: (p?.birthDate ?? '').trim(),
      phone: (p?.phone ?? '').toString(),
    }));
    let docs;
    try {
      docs = await evaluateRequiredDocs(supabase, { companyId, participants: docPersons, workEnd });
    } catch (e) {
      console.error('[work-permits POST] docs check:', e);
      return NextResponse.json(
        { success: false, code: 'DOC_QUERY_FAILED', message: '필수서류 확인 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }
    if (!docs.allValid) {
      return NextResponse.json(
        {
          success: false,
          code: 'DOCS_REQUIRED',
          message: '필수서류(개인서약/업체이행각서)가 미비합니다. "필수서류 확인" 단계에서 작성 후 제출해 주세요.',
          data: {
            missing: {
              pledges: docs.pledges.filter((p) => p.status !== 'VALID').map((p) => p.name),
              undertaking: docs.undertaking.status === 'VALID' ? null : docs.undertaking.status,
              undertakingMissingMembers: docs.undertaking.missingMembers,
            },
          },
        },
        { status: 403 }
      );
    }

    // ---- 4. 보충작업 정규화 (7종, Y/N) ----
    const supplemental: Record<string, 'Y' | 'N'> = {};
    for (const k of SUPPLEMENTAL_KEYS) {
      supplemental[k] = supplementalIn?.[k] === 'Y' ? 'Y' : 'N';
    }

    // ---- 5. TBM 스냅샷 (헤더 + 참석자 + R-6 디지털 상세) ----
    const safetyManagerName = (tbmDetailIn.safetyManagerName ?? '').trim() || null;
    // 안전관리자 소속: 사내(동남) 또는 작업업체 — UI 토글 값
    const smCompany =
      tbmDetailIn.safetyManagerAffiliation === 'CONTRACTOR' ? company.name : '동남';
    const tbm = {
      datetime: workStart,
      place: workLocation,
      workName,
      // 현장소장/안전담당 = 신청인. 신청인 서명을 TBM 실시자 서명으로 사용.
      teamLeader: { company: company.name, name: applicantName, signature: applicantSignature },
      safetyManager: safetyManagerName
        ? { name: safetyManagerName, company: smCompany, signature: safetyManagerSignature }
        : null,
      workContent: (tbmDetailIn.workContent ?? '').trim() || null,
      riskFactors: asStrArray(tbmDetailIn.riskFactors).slice(0, 6),
      safetyMeasures: asStrArray(tbmDetailIn.safetyMeasures).slice(0, 6),
      attendees: evaluated.map((e) => ({ name: e.name, company: e.companyName })),
      // 사진은 Storage 업로드 후 경로로 채운다(아래). 초기엔 빈 배열.
      photos: [] as string[],
    };
    const photoDataUrls = photosIn.filter(isValidPhoto).slice(0, 2);

    // ---- 6. 신청번호 RPC + 충돌 재시도(≤3) → work_permits INSERT ----
    let permit: any = null;
    let lastErr: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let permitNumber: string;
      try {
        permitNumber = await generateWorkPermitNumber(supabase);
      } catch (e) {
        lastErr = e;
        continue;
      }
      const { data, error } = await supabase
        .from('work_permits')
        .insert({
          permit_number: permitNumber,
          permit_type: 'GENERAL',
          request_company_id: company.id,
          request_company_name: company.name, // 스냅샷
          work_name: workName,
          work_location: workLocation,
          work_start: new Date(workStart).toISOString(),
          work_end: new Date(workEnd).toISOString(),
          work_content: workContent,
          applicant_name: applicantName,
          applicant_phone: applicantPhone,
          applicant_title: applicantTitle,
          applicant_birth_date: applicantBirthDate,
          equipment_no: equipmentNo,
          tbm,
          supplemental,
          equipment, // 중장비·굴착 장비(종류·차량번호·대조결과)
          // R-6: 신청인 서명 + 승인자(요청부서 현장책임자) 정보. 승인자 서명은 후속 단계.
          applicant_signature: applicantSignature,
          approver_name: approverName,
          approver_title: approverTitle,
          approval_mode: approvalMode,
          status: 'SUBMITTED',
        })
        .select('id, permit_number, status, created_at')
        .single();

      if (!error && data) {
        permit = data;
        break;
      }
      // UNIQUE 충돌(23505)이면 재시도, 그 외 에러는 중단
      lastErr = error;
      if (error && (error as any).code !== '23505') break;
    }

    if (!permit) {
      console.error('[work-permits POST] insert failed:', lastErr);
      return NextResponse.json(
        { success: false, code: 'SAVE_FAILED', message: '작업허가 신청 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 500 }
      );
    }

    // ---- 7. 참여자 스냅샷 INSERT ----
    const participantRows = evaluated.map((e, i) => ({
      work_permit_id: permit.id,
      session_id: e.sessionId,
      name: e.name,
      phone: e.phone,
      company_id: e.companyId,
      company_name: e.companyName, // 스냅샷
      target_type: e.targetCode,
      vehicle_number: e.vehicleNumber,
      equipment_type: e.equipmentType,
      spec: e.spec,
      completed_at: e.completedAt,
      expires_at: e.expiresAt, // 신청 시점 유효기간 스냅샷
      sort_order: i,
    }));

    const { error: partErr } = await supabase
      .from('work_permit_participants')
      .insert(participantRows);

    if (partErr) {
      // 본문은 저장됐으나 참여자 저장 실패 → 본문 롤백(고아 방지)
      console.error('[work-permits POST] participants insert failed, rolling back:', partErr);
      await supabase.from('work_permits').delete().eq('id', permit.id);
      return NextResponse.json(
        { success: false, code: 'SAVE_FAILED', message: '참여자 저장에 실패했습니다. 다시 시도해 주세요.' },
        { status: 500 }
      );
    }

    // ---- 7.5 TBM 현장 사진 Storage 업로드(비공개 버킷) → tbm.photos = 경로 ----
    if (photoDataUrls.length > 0) {
      const paths: string[] = [];
      for (let i = 0; i < photoDataUrls.length; i++) {
        const m = photoDataUrls[i].match(/^data:image\/(\w+);base64,(.+)$/);
        if (!m) continue;
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        const buf = Buffer.from(m[2], 'base64');
        const key = `permits/${permit.id}/${i}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('work-permit-photos')
          .upload(key, buf, { contentType: `image/${m[1]}`, upsert: true });
        if (upErr) {
          console.error('[work-permits POST] photo upload failed:', upErr);
        } else {
          paths.push(key);
        }
      }
      if (paths.length > 0) {
        const { error: tbmErr } = await supabase
          .from('work_permits')
          .update({ tbm: { ...tbm, photos: paths } })
          .eq('id', permit.id);
        if (tbmErr) console.error('[work-permits POST] tbm photos patch failed:', tbmErr);
      }
    }

    // [R-5] 담당자 알림 — 작업허가 신청 접수 (best-effort, 담당자 폰 = 발신번호와 동일)
    try {
      const managerPhone = process.env.SOLAPI_SENDER;
      if (managerPhone) {
        const sms = await sendSms(managerPhone, `[동남] 작업허가 신청 ${permit.permit_number} ${company.name}`);
        if (!sms.ok) console.error('[work-permits POST] notify sms failed:', sms.code, sms.message);
      }
    } catch (e) {
      console.error('[work-permits POST] notify sms unexpected:', e);
    }

    return NextResponse.json({
      success: true,
      data: {
        permitId: permit.id,
        permitNumber: permit.permit_number,
        status: permit.status,
        createdAt: permit.created_at,
      },
    });
  } catch (e) {
    console.error('[work-permits POST] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
