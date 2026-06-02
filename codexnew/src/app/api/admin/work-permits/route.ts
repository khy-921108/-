import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const keyword = (url.searchParams.get('keyword') ?? '').trim();
  const dateFrom = (url.searchParams.get('dateFrom') ?? '').trim();
  const dateTo = (url.searchParams.get('dateTo') ?? '').trim();

  const supabase = createServiceClient();
  let q = supabase
    .from('work_permits')
    .select(
      'id, permit_number, permit_type, request_company_name, work_name, work_start, work_end, applicant_name, supplemental, status, created_at'
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

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    q = q.gte('work_start', `${dateFrom}T00:00:00+09:00`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    q = q.lte('work_start', `${dateTo}T23:59:59+09:00`);
  }

  const { data: permits, error } = await q;
  if (error) {
    console.error('[admin/work-permits] error:', error);
    return NextResponse.json(
      { success: false, code: 'QUERY_FAILED', message: error.message },
      { status: 500 }
    );
  }

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

  const items = (permits ?? []).map((p: any) => ({
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
    createdAt: p.created_at,
  }));

  return NextResponse.json({
    success: true,
    data: { items, totalCount: items.length },
  });
}
