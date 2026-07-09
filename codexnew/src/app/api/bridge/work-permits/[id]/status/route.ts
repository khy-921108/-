/**
 * src/app/api/bridge/work-permits/[id]/status/route.ts — 작업허가 승인/반려 (SHE 포털용)
 *
 * [R-2] x-bridge-key 게이트. body {action:'APPROVE'|'REJECT', actor:'<포털 사용자 이메일>'}
 * - APPROVE → status APPROVED / REJECT → status REJECTED. approved_by/at 기록.
 * - ⚠️ 승인은 표시·기록용일 뿐 출력(xlsx/A4)을 막지 않음. 다른 필드/출력 로직 무변경.
 * - 없는 id → 404, 이미 처리된 건(status≠SUBMITTED) → 409.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { sendSms } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store'; // 상태 재조회 캐시 방지(중복 처리 방지)

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const key = process.env.BRIDGE_KEY;
  if (!key) return NextResponse.json({ error: 'BRIDGE_DISABLED' }, { status: 503 });
  if (req.headers.get('x-bridge-key') !== key) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action;
  const actor = typeof body.actor === 'string' && body.actor ? body.actor : 'portal';
  const signature = typeof body.signature === 'string' ? body.signature : '';
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : null;
  if (action !== 'APPROVE' && action !== 'REJECT') {
    return NextResponse.json({ error: 'INVALID_ACTION' }, { status: 400 });
  }
  // B안: 승인 = 1차 발급(손서명 필수). 서명 없는 APPROVE 거부(반쪽 승인 방지).
  if (action === 'APPROVE' && !signature.startsWith('data:image/')) {
    return NextResponse.json({ error: 'SIGNATURE_REQUIRED', message: '승인하려면 손서명이 필요합니다.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: permit } = await supabase
    .from('work_permits')
    .select('id, status, permit_number, applicant_phone, issuer_signature')
    .eq('id', ctx.params.id)
    .maybeSingle();

  if (!permit) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  // 이미 1차 승인(발급 서명)된 건 재승인/반려 금지(관리자·포털 이중승인 방지)
  if (permit.issuer_signature || permit.status !== 'SUBMITTED') {
    return NextResponse.json(
      { error: 'ALREADY_PROCESSED', currentStatus: permit.issuer_signature ? 'APPROVED' : permit.status },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  // APPROVE = 관리자 1차 발급과 동일: issuer_signature + approved_by/at (status 미변경 — 단계뱃지는 서명 기반).
  // REJECT  = status REJECTED (서명 불필요).
  const update =
    action === 'APPROVE'
      ? { issuer_signature: signature, issuer_title: title, approved_by: actor, approved_at: now }
      : { status: 'REJECTED', approved_by: actor, approved_at: now };
  const { error } = await supabase.from('work_permits').update(update).eq('id', ctx.params.id);

  if (error) {
    return NextResponse.json({ error: 'UPDATE_FAILED', message: error.message }, { status: 500 });
  }
  const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

  // [R-5] 신청자 통지 문자 — best-effort (실패해도 본 처리는 성공 유지)
  try {
    if (permit.applicant_phone) {
      const msg =
        action === 'APPROVE'
          ? `[동남] 작업허가 ${permit.permit_number} 승인되었습니다.`
          : `[동남] 작업허가 ${permit.permit_number} 반려되었습니다. 문의: 안전보건팀`;
      const sms = await sendSms(permit.applicant_phone, msg);
      if (!sms.ok) console.error('[bridge/work-permits status] sms failed:', sms.code, sms.message);
    }
  } catch (e) {
    console.error('[bridge/work-permits status] sms unexpected:', e);
  }

  return NextResponse.json({ ok: true, status: newStatus });
}
