import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { isEquipmentType, isMemberType, normalizePhone } from '@/lib/equipment';

export const runtime = 'nodejs';

/**
 * POST /api/admin/companies/:id/members/add  (requireAdmin)
 * - 어드민이 화면에서 인원 1명을 그 업체 명단(company_members)에 직접 추가.
 * - 키 (company_id, name, birth_date, normalized_phone) — ON CONFLICT DO NOTHING(중복추가 무시).
 * - 업체는 URL 경로로 고정(타업체 혼입 차단).
 * req: { name(필수), birthDate, phone, memberType, vehicleNumber, equipmentType, equipmentTypeEtc, spec }
 */
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission('COMPANIES_EDIT');
  if (!auth.ok) return auth.response;

  const companyId = ctx.params.id;
  const supabase = createServiceClient();

  // 업체 존재 확인
  const { data: company, error: cErr } = await supabase
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .maybeSingle();
  if (cErr) {
    console.error('[members/add] company:', cErr);
    return NextResponse.json({ success: false, code: 'QUERY_FAILED', message: cErr.message }, { status: 500 });
  }
  if (!company) {
    return NextResponse.json({ success: false, code: 'NOT_FOUND', message: '업체를 찾을 수 없습니다.' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const name = (typeof body.name === 'string' ? body.name : '').trim();
  const birthDate = (typeof body.birthDate === 'string' ? body.birthDate : '').trim() || null;
  const phoneRaw = typeof body.phone === 'string' ? body.phone : '';
  const memberType = isMemberType(body.memberType) ? body.memberType : 'WORKER';
  const vehicleNumber = (typeof body.vehicleNumber === 'string' ? body.vehicleNumber : '').trim() || null;
  const equipmentTypeEtc = (typeof body.equipmentTypeEtc === 'string' ? body.equipmentTypeEtc : '').trim() || null;
  const spec = (typeof body.spec === 'string' ? body.spec : '').trim() || null;

  if (!name) {
    return NextResponse.json({ success: false, code: 'INVALID_INPUT', message: '이름을 입력해 주세요.' }, { status: 400 });
  }

  // 생년월일 형식(있으면 YYYY-MM-DD)
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
    return NextResponse.json({ success: false, code: 'INVALID_BIRTH', message: '생년월일 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  // 장비종류(있으면 화이트리스트)
  let equipmentType: string | null = null;
  if (body.equipmentType != null && body.equipmentType !== '') {
    if (!isEquipmentType(body.equipmentType)) {
      return NextResponse.json({ success: false, code: 'INVALID_EQUIPMENT', message: '장비종류가 올바르지 않습니다.' }, { status: 400 });
    }
    equipmentType = body.equipmentType;
  }

  const values = {
    company_id: companyId, // 경로 고정
    member_type: memberType,
    name,
    birth_date: birthDate,
    phone: phoneRaw.trim() || null,
    normalized_phone: normalizePhone(phoneRaw),
    vehicle_number: vehicleNumber,
    equipment_type: equipmentType,
    equipment_type_etc: equipmentType === 'ETC' ? equipmentTypeEtc : null,
    spec,
  };

  // ON CONFLICT DO NOTHING — 이미 있으면 추가 안 함(기존값 보존)
  const { data, error } = await supabase
    .from('company_members')
    .upsert(values, {
      onConflict: 'company_id,name,birth_date,normalized_phone',
      ignoreDuplicates: true,
    })
    .select('id');
  if (error) {
    console.error('[members/add] upsert:', error);
    return NextResponse.json({ success: false, code: 'SAVE_FAILED', message: error.message }, { status: 500 });
  }

  const added = Array.isArray(data) && data.length > 0;
  return NextResponse.json({
    success: true,
    data: { added, id: added ? data![0].id : null },
    message: added ? '인원을 추가했습니다.' : '이미 명단에 있는 인원입니다(중복 무시).',
  });
}
