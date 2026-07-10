import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { getSignatureStatusForPermits } from '@/lib/safety-doc-status';
import { stageFromLightRow } from '@/lib/work-permit-stage';

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

  const supabase = createServiceClient();
  let q = supabase
    .from('work_permits')
    .select(
      `id, permit_number, permit_type, request_company_name, work_name, work_start, work_end,
       applicant_name, supplemental, status, approved_by, approved_at, created_at,
       issuer_signature, started_at`
    )
    .order('work_start', { ascending: false })
    .limit(500);

  if (keyword) {
    const safe = keyword.replace(/[%,]/g, ' ').trim();
    if (safe) {
      q = q.or(
        `permit_number.ilike.%${safe}%,request_company_name.ilike.%${safe}%,work_name.ilike.%${safe}%,applicant_name.ilike.%${safe}%`
      );
    }
  }

  // 조회 월과 작업기간(work_start~work_end)이 겹치는 허가서 — KST 기준
  //  겹침 조건: work_start <= 월말 AND work_end >= 월초
  if (/^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const monthStart = `${month}-01T00:00:00+09:00`;
    const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}T23:59:59+09:00`;
    q = q.lte('work_start', monthEnd).gte('work_end', monthStart);
  }

  const { data: permits, error } = await q;
  if (error) {
    console.error('[admin/work-permits] error:', error);
    return NextResponse.json(
      { success: false, code: 'QUERY_FAILED', message: error.message },
      { status: 500 }
    );
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
      stage: stageFromLightRow(p), // R-6 진행단계(목록 경량뱃지) — 무거운 서명 blob 조회 회피
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
