import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { parseCompanyMembersWorkbook, type ParseWarning } from '@/lib/excel-helpers';

export const runtime = 'nodejs';

/**
 * POST /api/admin/companies/:id/members/import?dryRun=1  (requireAdmin)
 * - 그 업체 인원만 엑셀로 갱신(1B 전체 import 의 단일업체 버전).
 * - 업체는 URL 경로로 고정 → 엑셀의 업체명 컬럼은 보지 않음(타업체 혼입 차단).
 * - dryRun=1 → 파싱·검증 결과만(미반영). 아니면 company_members upsert.
 * - 매칭 키: (company_id, name, birth_date, normalized_phone).
 */
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const companyId = ctx.params.id;
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';

  const supabase = createServiceClient();

  // 업체 존재 확인(경로 고정 — 타업체 혼입 방지의 핵심)
  const { data: company, error: cErr } = await supabase
    .from('companies')
    .select('id, name')
    .eq('id', companyId)
    .maybeSingle();
  if (cErr) {
    console.error('[members/import] company:', cErr);
    return NextResponse.json({ success: false, code: 'QUERY_FAILED', message: cErr.message }, { status: 500 });
  }
  if (!company) {
    return NextResponse.json({ success: false, code: 'NOT_FOUND', message: '업체를 찾을 수 없습니다.' }, { status: 404 });
  }

  // 파일 수신
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    console.error('[members/import] formData:', e);
    return NextResponse.json({ success: false, code: 'INVALID_MULTIPART', message: 'multipart/form-data 가 아닙니다.' }, { status: 400 });
  }
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ success: false, code: 'FILE_REQUIRED', message: '파일이 첨부되지 않았습니다.' }, { status: 400 });
  }
  const arrayBuffer = await (file as Blob).arrayBuffer();
  if (arrayBuffer.byteLength > 8 * 1024 * 1024) {
    return NextResponse.json({ success: false, code: 'FILE_TOO_LARGE', message: '파일 크기가 8MB 를 초과합니다.' }, { status: 400 });
  }

  const parsed = await parseCompanyMembersWorkbook(arrayBuffer);
  const errors = [...parsed.errors];
  const warnings: ParseWarning[] = [...parsed.warnings];

  // 헤더/시트 치명 오류(rowIndex ≤ 1) → 즉시 미리보기 반환
  const fatal = errors.some((e) => e.rowIndex <= 1);
  if (fatal) {
    return NextResponse.json(
      {
        success: false,
        code: 'PARSE_FAILED',
        data: { dryRun: true, members: { count: 0, rows: [] }, errors, warnings },
        message: '엑셀 구조가 양식과 일치하지 않습니다. "인원" 시트와 "이름" 헤더를 확인해 주세요.',
      },
      { status: 400 }
    );
  }

  const previewMembers = parsed.members.map((m) => ({
    rowIndex: m.rowIndex,
    member_type: m.memberType,
    name: m.name,
    birth_date: m.birthDate,
    phone: m.phone,
    vehicle_number: m.vehicleNumber,
    equipment_type: m.equipmentType,
    equipment_type_etc: m.equipmentTypeEtc,
    spec: m.spec,
    note: m.note,
  }));

  const hasRowErrors = errors.some((e) => e.rowIndex > 1);

  // dryRun 또는 행 오류 → 미리보기만
  if (dryRun || hasRowErrors) {
    return NextResponse.json(
      {
        success: !hasRowErrors,
        code: hasRowErrors ? 'HAS_ROW_ERRORS' : 'PREVIEW_OK',
        data: {
          dryRun: true,
          company: { id: company.id, name: company.name },
          members: { count: previewMembers.length, rows: previewMembers },
          errors,
          warnings,
        },
        message: hasRowErrors ? '오류가 있는 행이 있어 반영할 수 없습니다.' : '검증 통과 — 미리보기',
      },
      { status: hasRowErrors ? 400 : 200 }
    );
  }

  // ===== 실제 반영: 이 업체에만 upsert =====
  const result = { inserted: 0, updated: 0 };
  for (const m of parsed.members) {
    const baseValues = {
      company_id: companyId, // 경로 고정 — 엑셀 값 무시
      member_type: m.memberType,
      name: m.name,
      birth_date: m.birthDate,
      phone: m.phone,
      normalized_phone: m.normalizedPhone,
      vehicle_number: m.vehicleNumber,
      equipment_type: m.equipmentType,
      equipment_type_etc: m.equipmentTypeEtc,
      spec: m.spec,
      note: m.note,
    };

    let q = supabase.from('company_members').select('id').eq('company_id', companyId).eq('name', m.name);
    q = m.birthDate ? q.eq('birth_date', m.birthDate) : q.is('birth_date', null);
    q = m.normalizedPhone ? q.eq('normalized_phone', m.normalizedPhone) : q.is('normalized_phone', null);

    const { data: existing, error: selErr } = await q.maybeSingle();
    if (selErr) {
      console.error('[members/import] select:', selErr);
      return NextResponse.json({ success: false, code: 'QUERY_FAILED', message: selErr.message }, { status: 500 });
    }
    if (existing) {
      const { error } = await supabase.from('company_members').update(baseValues).eq('id', existing.id);
      if (error) {
        console.error('[members/import] update:', error);
        return NextResponse.json({ success: false, code: 'UPDATE_FAILED', message: error.message }, { status: 500 });
      }
      result.updated += 1;
    } else {
      const { error } = await supabase.from('company_members').insert(baseValues);
      if (error) {
        console.error('[members/import] insert:', error);
        return NextResponse.json({ success: false, code: 'INSERT_FAILED', message: error.message }, { status: 500 });
      }
      result.inserted += 1;
    }
  }

  return NextResponse.json({
    success: true,
    code: 'IMPORTED',
    data: {
      dryRun: false,
      company: { id: company.id, name: company.name },
      members: result,
      errors: [],
      warnings,
    },
  });
}
