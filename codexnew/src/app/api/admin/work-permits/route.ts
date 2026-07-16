import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { getSignatureStatusForPermits } from '@/lib/safety-doc-status';
import { stageFromRow } from '@/lib/work-permit-stage';

// 목록은 승인·되돌리기로 수시 변하므로 라우트 캐시 금지(과거 stale 캐시 버그 재발 방지 원칙).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * GET /api/admin/work-permits  (requireAdmin) — 신청 목록
 * res: { success, data:{ items:[{permitId,permitNumber,permitType,companyName,workName,
 *                               applicantName,participantCount,createdAt,status,supplemental}], totalCount } }
 */
export async function GET(req: Request) {
  const auth = await requirePermission('WORKPERMITS_VIEW');
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const keyword = (url.searchParams.get('keyword') ?? '').trim();
  const month = (url.searchParams.get('month') ?? '').trim(); // 조회 월 (YYYY-MM, KST)
  const year = (url.searchParams.get('year') ?? '').trim();   // 조회 년 (YYYY, KST) — 년별 전환

  const supabase = createServiceClient();
  // 겹침 범위(KST): 월별 또는 년별. 조건: work_start <= 범위끝 AND work_end >= 범위시작
  let rangeStart = '';
  let rangeEnd = '';
  if (/^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    rangeStart = `${month}-01T00:00:00+09:00`;
    rangeEnd = `${month}-${String(lastDay).padStart(2, '0')}T23:59:59+09:00`;
  } else if (/^\d{4}$/.test(year)) {
    rangeStart = `${year}-01-01T00:00:00+09:00`;
    rangeEnd = `${year}-12-31T23:59:59+09:00`;
  }

  // 년별 조회는 500건을 넘을 수 있어 페이지네이션으로 전량 조회(누락 방지)
  const permits: any[] = [];
  const size = 1000;
  let from = 0;
  for (;;) {
    let q = supabase
      .from('work_permits')
      .select(
        `id, permit_number, permit_type, request_company_name, work_name, work_start, work_end,
         applicant_name, supplemental, status, approved_by, approved_at, created_at,
         issuer_signature, started_at, completion, tbm, dept_confirmations`
      )
      .order('work_start', { ascending: false });
    if (keyword) {
      const safe = keyword.replace(/[%,]/g, ' ').trim();
      if (safe) {
        q = q.or(
          `permit_number.ilike.%${safe}%,request_company_name.ilike.%${safe}%,work_name.ilike.%${safe}%,applicant_name.ilike.%${safe}%`
        );
      }
    }
    if (rangeStart) q = q.lte('work_start', rangeEnd).gte('work_end', rangeStart);
    const { data, error } = await q.range(from, from + size - 1);
    if (error) {
      console.error('[admin/work-permits] error:', error);
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: error.message },
        { status: 500 }
      );
    }
    if (!data || data.length === 0) break;
    permits.push(...data);
    if (data.length < size) break;
    from += size;
  }

  // 참여자 수 집계
  const ids = (permits ?? []).map((p: any) => p.id);
  const countMap = new Map<string, number>();
  if (ids.length > 0) {
    const { data: parts } = await supabase
      .from('work_permit_participants')
      .select('work_permit_id')
      .in('work_permit_id', ids);
    (parts ?? []).forEach((p: any) => {
      countMap.set(p.work_permit_id, (countMap.get(p.work_permit_id) ?? 0) + 1);
    });
  }

  // 개인서약 서명 상태 일괄 집계 (참여자 ↔ safety_pledges 최신서약 signature)
  let sigMap: Awaited<ReturnType<typeof getSignatureStatusForPermits>> = {};
  try {
    sigMap = await getSignatureStatusForPermits(supabase, ids);
  } catch (e) {
    console.error('[admin/work-permits] signature status:', e);
  }

  const now = Date.now(); // 미종료/기간 경과 판정 기준(렌더 시각)
  const items = (permits ?? []).map((p: any) => {
    const sig = sigMap[p.id] ?? { total: 0, signed: 0, unsigned: 0, unsignedNames: [], participants: [] };
    return {
      permitId: p.id,
      permitNumber: p.permit_number,
      permitType: p.permit_type,
      companyName: p.request_company_name,
      workName: p.work_name,
      workStart: p.work_start,
      workEnd: p.work_end,
      applicantName: p.applicant_name,
      participantCount: countMap.get(p.id) ?? 0,
      supplemental: p.supplemental ?? {},
      status: p.status,
      stage: stageFromRow(p, now), // R-6 진행단계(full-stage — 3분류 탭·상세·업체·포털·print와 동일 판정)
      approvedBy: p.approved_by ?? null,
      approvedAt: p.approved_at ?? null,
      createdAt: p.created_at,
      signature: {
        total: sig.total,
        signed: sig.signed,
        unsigned: sig.unsigned,
        unsignedNames: sig.unsignedNames,
        participants: sig.participants,
      },
    };
  });

  return NextResponse.json({
    success: true,
    data: { items, totalCount: items.length },
  });
}
