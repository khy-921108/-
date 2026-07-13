import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { getCompanyRoster } from '@/lib/company-roster';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * GET /api/admin/companies/:id/members  (requireAdmin, PII 포함)
 * - 업체 통합 인원현황(사람 기준 병합): company_members(마스터) ∪ training_sessions+completions(교육).
 * - 응답: { company, items, stats } — 화면 모달 호환.
 * - 병합/상태 판정은 lib/company-roster (화면=엑셀 동일 기준).
 * - 업체 범위만 조회(타업체 인원 미노출).
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission('COMPANIES_VIEW');
  if (!auth.ok) return auth.response;

  const supabase = createServiceClient();
  const r = await getCompanyRoster(supabase, ctx.params.id);
  if (!r.ok) {
    if (r.code !== 'NOT_FOUND') {
      console.error('[admin/companies/:id/members] roster:', r.message);
    }
    return NextResponse.json({ success: false, code: r.code, message: r.message }, { status: r.status });
  }

  return NextResponse.json({
    success: true,
    data: {
      company: r.roster.company,
      items: r.roster.items,
      stats: r.roster.stats,
    },
  });
}
