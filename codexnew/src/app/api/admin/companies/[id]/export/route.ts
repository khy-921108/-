import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { getCompanyRoster } from '@/lib/company-roster';
import { buildCompanyRosterWorkbook } from '@/lib/excel-helpers';
import type { CompanyType, CompanyStatus } from '@/lib/company';
import type { EquipmentType, MemberType } from '@/lib/equipment';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export const runtime = 'nodejs'; // exceljs 는 node 런타임 필요

/**
 * GET /api/admin/companies/:id/export  (requireAdmin)
 * - 단일 업체 .xlsx: 시트1 업체정보 + 시트2 통합 인원(교육상태 포함).
 * - 인원/현황 화면과 동일 기준(lib/company-roster).
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission('EXCEL_EXPORT');
  if (!auth.ok) return auth.response;

  const supabase = createServiceClient();
  const r = await getCompanyRoster(supabase, ctx.params.id);
  if (!r.ok) {
    if (r.code !== 'NOT_FOUND') console.error('[admin/companies/:id/export] roster:', r.message);
    return NextResponse.json({ success: false, code: r.code, message: r.message }, { status: r.status });
  }

  const { company, items } = r.roster;

  const buffer = await buildCompanyRosterWorkbook({
    company: {
      name: company.name,
      biz_no: company.biz_no,
      company_type: company.company_type as CompanyType,
      manager_name: company.manager_name,
      phone: company.phone,
      status: company.status as CompanyStatus,
      created_by: company.created_by,
    },
    members: items.map((m) => ({
      member_type: m.member_type as MemberType | null,
      name: m.name,
      birth_date: m.birth_date,
      phone: m.phone,
      vehicle_number: m.vehicle_number,
      equipment_type: m.equipment_type as EquipmentType | null,
      equipment_type_etc: m.equipment_type_etc,
      spec: m.spec,
      note: m.note,
      completed_at: m.completed_at,
      expires_at: m.expires_at,
      completion_status: m.completion_status,
    })),
  });

  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}${mo}${d}`;
  const asciiName = `company-${dateStr}.xlsx`;
  const utf8Name = encodeURIComponent(`${company.name}-인원현황-${dateStr}.xlsx`);

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
      'Cache-Control': 'no-store',
    },
  });
}
