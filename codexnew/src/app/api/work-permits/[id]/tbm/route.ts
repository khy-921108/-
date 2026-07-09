import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/equipment';
import { sendSms } from '@/lib/sms';

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
      .select('id, permit_number, work_name, status, applicant_name, applicant_birth_date, applicant_phone, issuer_signature, tbm')
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

  // ── photo: 사진 1장 업로드 ──
  if (action === 'photo') {
    const image = (body?.image ?? '').toString();
    const m = image.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!m) return NextResponse.json({ success: false, code: 'BAD_IMAGE', message: '이미지 형식이 올바르지 않습니다.' }, { status: 400 });
    if (photos.length >= 2) return NextResponse.json({ success: false, code: 'PHOTO_FULL', message: '사진은 최대 2장까지입니다.' }, { status: 409 });
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 1.5 * 1024 * 1024) return NextResponse.json({ success: false, code: 'TOO_LARGE', message: '사진 용량이 큽니다(리사이즈 후 업로드).' }, { status: 413 });
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const key = `permits/${permitId}/tbm-${Date.now()}.${ext}`;
    const { error: upErr } = await withTimeout(
      supabase.storage.from('work-permit-photos').upload(key, buf, { contentType: `image/${m[1]}`, upsert: true }),
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
    if (!signature.startsWith('data:image/')) return NextResponse.json({ success: false, code: 'NO_SIGNATURE', message: '서명을 입력해 주세요.' }, { status: 400 });
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
