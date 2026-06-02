import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getDocsForOutput } from '@/lib/safety-doc-status';

/**
 * GET /api/work-permits/:id  (공개, UUID 알아야) — 인쇄/양식용 데이터
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const supabase = createServiceClient();

  const { data: permit, error } = await supabase
    .from('work_permits')
    .select(
      `id, permit_number, permit_type, status, request_company_id, request_company_name,
       work_name, work_location, work_start, work_end, work_content,
       applicant_name, applicant_phone, applicant_title, equipment_no,
       tbm, supplemental, note, created_at`
    )
    .eq('id', ctx.params.id)
    .maybeSingle();

  if (error) {
    console.error('[work-permits/:id] error:', error);
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

  const { data: parts, error: partErr } = await supabase
    .from('work_permit_participants')
    .select(
      'name, phone, company_name, target_type, vehicle_number, equipment_type, spec, completed_at, expires_at, sort_order'
    )
    .eq('work_permit_id', ctx.params.id)
    .order('sort_order', { ascending: true });

  if (partErr) {
    console.error('[work-permits/:id] participants:', partErr);
    return NextResponse.json(
      { success: false, code: 'QUERY_FAILED', message: '참여자 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }

  let docs = null;
  try {
    docs = await getDocsForOutput(supabase, {
      companyId: permit.request_company_id ?? null,
      workStart: permit.work_start,
      participants: (parts ?? []).map((p: any) => ({
        name: p.name, phone: p.phone ?? null, companyName: p.company_name,
      })),
    });
  } catch (e) {
    console.error('[work-permits/:id] docs:', e);
  }

  return NextResponse.json({
    success: true,
    data: {
      permitId: permit.id,
      permitNumber: permit.permit_number,
      permitType: permit.permit_type,
      status: permit.status,
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
      tbm: permit.tbm ?? {},
      participants: (parts ?? []).map((p: any) => ({
        name: p.name,
        companyName: p.company_name,
        targetType: p.target_type,
        vehicleNumber: p.vehicle_number,
        equipmentType: p.equipment_type,
        spec: p.spec,
        completedAt: p.completed_at,
        expiresAt: p.expires_at,
      })),
      note: permit.note,
      createdAt: permit.created_at,
      docs,
    },
  });
}
