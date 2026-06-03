import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * DELETE /api/admin/companies/:id/members/:memberId  (requireAdmin)
 * - 그 업체의 company_members 행 1개만 삭제(교육기록 training_sessions 는 안 건드림).
 * - id + company_id 동시 매칭으로 타업체 인원 삭제 차단.
 */
export async function DELETE(_req: Request, ctx: { params: { id: string; memberId: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id: companyId, memberId } = ctx.params;
  const supabase = createServiceClient();

  // 소속 확인(타업체 인원 삭제 차단)
  const { data: member, error: selErr } = await supabase
    .from('company_members')
    .select('id')
    .eq('id', memberId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (selErr) {
    console.error('[members/:memberId DELETE] select:', selErr);
    return NextResponse.json({ success: false, code: 'QUERY_FAILED', message: selErr.message }, { status: 500 });
  }
  if (!member) {
    return NextResponse.json({ success: false, code: 'NOT_FOUND', message: '해당 업체의 인원을 찾을 수 없습니다.' }, { status: 404 });
  }

  const { error: delErr } = await supabase
    .from('company_members')
    .delete()
    .eq('id', memberId)
    .eq('company_id', companyId); // 격리 재확인
  if (delErr) {
    console.error('[members/:memberId DELETE] delete:', delErr);
    return NextResponse.json({ success: false, code: 'DELETE_FAILED', message: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
