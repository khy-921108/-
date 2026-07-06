/**
 * src/app/api/bridge/companies/[id]/status/route.ts — 업체 승인/반려 (SHE 포털용)
 *
 * [R-2] x-bridge-key 게이트. body {action:'APPROVE'|'REJECT', actor:'<포털 사용자 이메일>'}
 * - APPROVE → status ACTIVE(정식등록) / REJECT → status DISABLED(반려).
 * - status_changed_by/at 기록. 다른 필드 무변경.
 * - 없는 id → 404, 이미 처리된 건(status≠REVIEW) → 409.
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
  if (action !== 'APPROVE' && action !== 'REJECT') {
    return NextResponse.json({ error: 'INVALID_ACTION' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: company } = await supabase
    .from('companies')
    .select('id, status, name, phone')
    .eq('id', ctx.params.id)
    .maybeSingle();

  if (!company) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (company.status !== 'REVIEW') {
    return NextResponse.json(
      { error: 'ALREADY_PROCESSED', currentStatus: company.status },
      { status: 409 }
    );
  }

  const newStatus = action === 'APPROVE' ? 'ACTIVE' : 'DISABLED';
  const { error } = await supabase
    .from('companies')
    .update({ status: newStatus, status_changed_by: actor, status_changed_at: new Date().toISOString() })
    .eq('id', ctx.params.id);

  if (error) {
    return NextResponse.json({ error: 'UPDATE_FAILED', message: error.message }, { status: 500 });
  }

  // [R-5] 업체 담당자 통지 문자 — best-effort (실패해도 본 처리는 성공 유지)
  try {
    if (company.phone) {
      const msg =
        action === 'APPROVE'
          ? `[동남] ${company.name} 업체 등록이 승인되었습니다.`
          : `[동남] ${company.name} 업체 등록이 반려되었습니다. 문의: 안전보건팀`;
      const sms = await sendSms(company.phone, msg);
      if (!sms.ok) console.error('[bridge/companies status] sms failed:', sms.code, sms.message);
    }
  } catch (e) {
    console.error('[bridge/companies status] sms unexpected:', e);
  }

  return NextResponse.json({ ok: true, status: newStatus });
}
