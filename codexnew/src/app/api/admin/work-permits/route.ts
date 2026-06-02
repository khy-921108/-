import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const keyword = (url.searchParams.get('keyword') ?? '').trim();

  const supabase = createServiceClient();
  let q = supabase
    .from('work_permits')
    .select(
      'id, permit_number, permit_type, request_company_name, work_name, applicant_name, supplemental, status, created_at'
    )
    .order('created_at', { ascending: false })
    .limit(500);

  if (keyword) {
    const safe = keyword.replace(/[%,]/g, ' ').trim();
    if (safe) {
      q = q.or(
        `permit_number.ilike.%${safe}%,request_company_name.ilike.%${safe}%,work_name.ilike.%${safe}%,applicant_name.ilike.%${safe}%`
      );
    }
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
