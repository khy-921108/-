import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * GET /api/admin/completions?status=&keyword=&dateFrom=&dateTo=&targetType=
 * 수료 현황 목록 조회 (1차는 GET만).
 */
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const status = url.searchParams.get('status'); // VALID / EXPIRED / IN_PROGRESS / FAILED
  const keyword = url.searchParams.get('keyword');
  const dateFrom = url.searchParams.get('dateFrom');
  const dateTo = url.searchParams.get('dateTo');
  const targetType = url.searchParams.get('targetType');

  const supabase = createServiceClient();

  // 세션 기준으로 조회 (완료/미완료 모두 포함)
  let sq = supabase
    .from('training_sessions')
    .select(`
      id, name, affiliation, phone, birth_date, status, created_at,
      target_types(code, label),
      completions(id, completion_number, completed_at, expires_at, score)
    `, { count: 'exact' })
    .order('created_at', { ascending: false });

  if (keyword) sq = sq.or(`name.ilike.%${keyword}%,affiliation.ilike.%${keyword}%`);
  if (dateFrom) sq = sq.gte('created_at', new Date(dateFrom).toISOString());
  if (dateTo) {
    const end = new Date(dateTo);
    end.setDate(end.getDate() + 1);
    sq = sq.lt('created_at', end.toISOString());
  }
  if (targetType) {
    const { data: tt } = await supabase.from('target_types').select('id').eq('code', targetType).single();
    if (tt) sq = sq.eq('target_type_id', tt.id);
  }

  const { data, count, error } = await sq.limit(500);
  if (error) {
    console.error(error);
    return NextResponse.json(
      { success: false, code: 'QUERY_FAILED', message: '조회 실패' },
      { status: 500 }
    );
  }

  const now = Date.now();
  let items = (data ?? []).map((s: any) => {
    const c = s.completions?.[0];
    const expired = c ? new Date(c.expires_at).getTime() <= now : false;
    const computedStatus = c ? (expired ? 'EXPIRED' : 'VALID') : s.status;
    return {
      sessionId: s.id,
      name: s.name,
      affiliation: s.affiliation,
      phone: s.phone,
      birthDate: s.birth_date,
      targetType: s.target_types?.code,
      targetLabel: s.target_types?.label,
      status: computedStatus,
      createdAt: s.created_at,
      completionNumber: c?.completion_number ?? null,
      completedAt: c?.completed_at ?? null,
      validUntil: c?.expires_at ?? null,
      score: c?.score ?? null,
    };
  });

  // 상태 필터는 조인 결과가 있어야 정확히 분류 가능하므로 서버에서 후처리
  if (status) {
    items = items.filter((it) => it.status === status);
  }

  return NextResponse.json({
    success: true,
    data: {
      items,
      totalCount: items.length,
    },
  });
}
