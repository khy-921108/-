import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { fillWorkPermitWorkbook, type PermitDocData } from '@/lib/work-permit-template';
import { getDocsForOutput } from '@/lib/safety-doc-status';

export const runtime = 'nodejs';

/**
 * GET /api/work-permits/:id/xlsx  (공개, UUID 알아야) — 회사 양식 자동채움 다운로드
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const supabase = createServiceClient();

  const { data: permit, error } = await supabase
    .from('work_permits')
    .select(
      `id, permit_number, request_company_id, request_company_name, work_name, work_location,
       work_start, work_end, work_content, applicant_name, applicant_title,
       equipment_no, supplemental, note, created_at`
    )
    .eq('id', ctx.params.id)
    .maybeSingle();

  if (error) {
    console.error('[work-permits/:id/xlsx] error:', error);
    return NextResponse.json(
      { success: false, code: 'QUERY_FAILED', message: '조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
  if (!permit) {
    return NextResponse.json(
      { success: false, code: 'NOT_FOUND', message: '작업허가 신청을 찾을 수 없습니다.' },
      { status: 404 }
    );
  }

  const { data: parts } = await supabase
    .from('work_permit_participants')
    .select('name, phone, company_name, sort_order')
    .eq('work_permit_id', ctx.params.id)
    .order('sort_order', { ascending: true });

  const participantList = (parts ?? []).map((p: any) => ({
    name: p.name,
    phone: p.phone ?? null,
    companyName: p.company_name,
  }));

  let docs;
  try {
    docs = await getDocsForOutput(supabase, {
      companyId: permit.request_company_id ?? null,
      workStart: permit.work_start,
      participants: participantList,
    });
  } catch (e) {
    console.error('[work-permits/:id/xlsx] docs fetch:', e);
    docs = undefined;
  }

  const docData: PermitDocData = {
    permitNumber: permit.permit_number,
    companyName: permit.request_company_name,
    info: {
      workName: permit.work_name,
      workLocation: permit.work_location,
      workStart: permit.work_start,
      workEnd: permit.work_end,
      workContent: permit.work_content,
      applicantName: permit.applicant_name,
      applicantTitle: permit.applicant_title,
      equipmentNo: permit.equipment_no,
    },
    supplemental: permit.supplemental ?? {},
    participants: participantList.map((p) => ({ name: p.name, companyName: p.companyName })),
    note: permit.note,
    createdAt: permit.created_at,
    docs,
  };

  let buffer: Buffer;
  try {
    buffer = await fillWorkPermitWorkbook(docData);
  } catch (e) {
    console.error('[work-permits/:id/xlsx] fill error:', e);
    return NextResponse.json(
      { success: false, code: 'TEMPLATE_FAILED', message: '양식 생성에 실패했습니다.' },
      { status: 500 }
    );
  }

  const filename = `WP-${permit.permit_number}.xlsx`;
  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
