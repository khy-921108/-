import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * POST /api/work-permits/my-list  (공개) — 신청자 본인 신청내역 조회
 * - 본인(applicant_name + applicant_phone) 일치 건만 반환. 타인 명단 덤프 없음.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = (typeof body.name === 'string' ? body.name : '').trim();
    const phone = (typeof body.phone === 'string' ? body.phone : '').replace(/[^0-9]/g, '');

    if (!name || phone.length < 10) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '이름과 연락처를 정확히 입력해 주세요.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const { data: permits, error } = await supabase
      .from('work_permits')
      .select(
        'id, permit_number, work_name, work_start, work_end, request_company_name, supplemental, status, created_at'
      )
      .eq('applicant_name', name)
      .eq('applicant_phone', phone)
      .order('work_start', { ascending: false })
      .limit(200);

    if (error) {
      console.error('[work-permits/my-list] error:', error);
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: '조회 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }

    const items = (permits ?? []).map((p: any) => ({
      permitId: p.id,
      permitNumber: p.permit_number,
      workName: p.work_name,
      workStart: p.work_start,
      workEnd: p.work_end,
      companyName: p.request_company_name,
      supplemental: p.supplemental ?? {},
      status: p.status,
      createdAt: p.created_at,
    }));

    return NextResponse.json({ success: true, data: { items } });
  } catch (e) {
    console.error('[work-permits/my-list] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
