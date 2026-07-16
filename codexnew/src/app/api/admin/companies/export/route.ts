import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { buildCompaniesWorkbook } from '@/lib/excel-helpers';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export const runtime = 'nodejs'; // exceljs 는 node 런타임 필요

/**
 * GET /api/admin/companies/export
 * 업체 + 인원 마스터를 .xlsx 로 다운로드.
 * - 어드민 전용.
 * - 두 시트(업체/인원). 헤더는 사람이 읽는 라벨.
 */
export async function GET() {
  const auth = await requirePermission('EXCEL_EXPORT');
  if (!auth.ok) return auth.response;

  const supabase = createServiceClient();

  const { data: companies, error: companiesErr } = await supabase
    .from('companies')
    .select('id, name, biz_no, company_type, manager_name, phone, address, tel, biz_status, status, note')
    .order('name', { ascending: true })
    .limit(5000);
  if (companiesErr) {
    console.error('[admin/companies/export] companies err:', companiesErr);
    return NextResponse.json(
      { success: false, code: 'QUERY_FAILED', message: companiesErr.message },
      { status: 500 }
    );
  }

  const { data: members, error: membersErr } = await supabase
    .from('company_members')
    .select(
      'id, company_id, member_type, name, birth_date, phone, vehicle_number, equipment_type, equipment_type_etc, spec, note'
    )
    .order('name', { ascending: true })
    .limit(20000);
  if (membersErr) {
    console.error('[admin/companies/export] members err:', membersErr);
    return NextResponse.json(
      { success: false, code: 'QUERY_FAILED', message: membersErr.message },
      { status: 500 }
    );
  }

  // company_id → name 매핑
  const idToName = new Map<string, string>();
  (companies ?? []).forEach((c: { id: string; name: string }) => idToName.set(c.id, c.name));

  const buffer = await buildCompaniesWorkbook({
    companies: (companies ?? []).map((c: any) => ({
      name: c.name,
      biz_no: c.biz_no,
      company_type: c.company_type,
      manager_name: c.manager_name,
      phone: c.phone,
      address: c.address,
      tel: c.tel,
      biz_status: c.biz_status,
      status: c.status,
      note: c.note,
    })),
    members: (members ?? []).map((m: any) => ({
      member_type: m.member_type,
      company_name: (m.company_id && idToName.get(m.company_id)) ?? '',
      name: m.name,
      birth_date: m.birth_date,
      phone: m.phone,
      vehicle_number: m.vehicle_number,
      equipment_type: m.equipment_type,
      equipment_type_etc: m.equipment_type_etc,
      spec: m.spec,
      note: m.note,
    })),
  });

  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const filename = `companies-${y}${mo}${d}.xlsx`;

  // Node Buffer 는 런타임에 BodyInit 호환이지만 TS 타입 좁음 → 캐스팅
  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
