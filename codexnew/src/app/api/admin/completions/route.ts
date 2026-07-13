import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * GET /api/admin/completions?status=&keyword=&dateFrom=&dateTo=&targetType=
 * 수료 현황 목록 조회.
 * - training_sessions 와 completions 를 별도 조회 후 JS 에서 합친다.
 *   (PostgREST 중첩 JOIN 이 FK 관계를 못 찾으면 조용히 빈 배열이 되는 문제 회피)
 * - Supabase error 를 삼키지 않고 500 으로 반환한다.
 */
export async function GET(req: Request) {
  const auth = await requirePermission('COMPLETIONS_VIEW');
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const keyword = url.searchParams.get('keyword');
  const dateFrom = url.searchParams.get('dateFrom');
  const dateTo = url.searchParams.get('dateTo');
  const targetType = url.searchParams.get('targetType');

  const supabase = createServiceClient();

  // 1. training_sessions 조회 (target_types JOIN 은 읽기 전용 참조라 안전)
  let sq = supabase
    .from('training_sessions')
    .select(`
      id, name, affiliation, phone, birth_date, vehicle_number, status, created_at,
      target_types(code, label)
    `)
    .order('created_at', { ascending: false });

  if (keyword) sq = sq.or(`name.ilike.%${keyword}%,affiliation.ilike.%${keyword}%`);
  if (dateFrom) sq = sq.gte('created_at', new Date(dateFrom).toISOString());
  if (dateTo) {
    const end = new Date(dateTo);
    end.setDate(end.getDate() + 1);
    sq = sq.lt('created_at', end.toISOString());
  }
  if (targetType) {
    const { data: tt, error: ttErr } = await supabase
      .from('target_types')
      .select('id')
      .eq('code', targetType)
      .single();
    if (ttErr) {
      console.error('[admin/completions] target_types error:', ttErr);
      return NextResponse.json(
        { success: false, code: 'TARGET_TYPE_QUERY_FAILED', message: ttErr.message },
        { status: 500 }
      );
    }
    if (tt) sq = sq.eq('target_type_id', tt.id);
  }

  const { data: sessions, error: sessionsErr } = await sq.limit(500);
  if (sessionsErr) {
    console.error('[admin/completions] sessions error:', sessionsErr);
    return NextResponse.json(
      { success: false, code: 'SESSIONS_QUERY_FAILED', message: sessionsErr.message },
      { status: 500 }
    );
  }

  // 2. 해당 세션들의 completions 별도 조회 (중첩 JOIN 대신)
  const sessionIds = (sessions ?? []).map((s: any) => s.id);
  let completionMap = new Map<string, any>();

  if (sessionIds.length > 0) {
    const { data: completions, error: completionsErr } = await supabase
      .from('completions')
      .select('id, session_id, completion_number, completed_at, expires_at, score')
      .in('session_id', sessionIds);

    if (completionsErr) {
      console.error('[admin/completions] completions error:', completionsErr);
      return NextResponse.json(
        { success: false, code: 'COMPLETIONS_QUERY_FAILED', message: completionsErr.message },
        { status: 500 }
      );
    }

    (completions ?? []).forEach((c: any) => {
      const prev = completionMap.get(c.session_id);
      if (!prev || new Date(c.completed_at) > new Date(prev.completed_at)) {
        completionMap.set(c.session_id, c);
      }
    });
  }

  // 3. 합치기 + 상태 재계산
  const now = Date.now();
  let items = (sessions ?? []).map((s: any) => {
    const c = completionMap.get(s.id);
    const expired = c ? new Date(c.expires_at).getTime() <= now : false;
    const computedStatus = c ? (expired ? 'EXPIRED' : 'VALID') : s.status;
    const targetTypes = Array.isArray(s.target_types) ? s.target_types[0] : s.target_types;
    return {
      sessionId: s.id,
      name: s.name,
      affiliation: s.affiliation,
      phone: s.phone,
      birthDate: s.birth_date,
      vehicleNumber: s.vehicle_number ?? null,
      targetType: targetTypes?.code ?? null,
      targetLabel: targetTypes?.label ?? null,
      status: computedStatus,
      createdAt: s.created_at,
      completionNumber: c?.completion_number ?? null,
      completedAt: c?.completed_at ?? null,
      validUntil: c?.expires_at ?? null,
      score: c?.score ?? null,
    };
  });

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
