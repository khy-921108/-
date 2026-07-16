import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import {
  parseCompaniesWorkbook,
  type CompanyRowInput,
  type MemberRowInput,
  type ParseError,
  type ParseWarning,
} from '@/lib/excel-helpers';

export const runtime = 'nodejs';

/**
 * POST /api/admin/companies/import?dryRun=1
 * - multipart/form-data 의 "file" 필드로 .xlsx 업로드.
 * - dryRun=1 → 파싱 + 검증 결과만 JSON 으로 반환 (DB 반영 없음).
 * - dryRun != 1 → upsert 실제 반영.
 *
 * 매칭 키:
 *   companies: name (대소문자 무시) → 없으면 신규 생성 (status=REVIEW, created_by=ADMIN, warning 으로 표시)
 *   company_members: (company_id, name, birth_date, normalized_phone) UNIQUE NULLS NOT DISTINCT
 */
export async function POST(req: Request) {
  const auth = await requirePermission('EXCEL_IMPORT');
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e) {
    console.error('[admin/companies/import] formData parse:', e);
    return NextResponse.json(
      { success: false, code: 'INVALID_MULTIPART', message: 'multipart/form-data 가 아닙니다.' },
      { status: 400 }
    );
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json(
      { success: false, code: 'FILE_REQUIRED', message: '파일이 첨부되지 않았습니다.' },
      { status: 400 }
    );
  }

  // Vercel serverless body limit ~4.5MB — 보수적으로 8MB 한도
  const arrayBuffer = await (file as Blob).arrayBuffer();
  if (arrayBuffer.byteLength > 8 * 1024 * 1024) {
    return NextResponse.json(
      { success: false, code: 'FILE_TOO_LARGE', message: '파일 크기가 8MB 를 초과합니다.' },
      { status: 400 }
    );
  }

  const parsed = await parseCompaniesWorkbook(arrayBuffer);
  const errors: ParseError[] = [...parsed.errors];
  const warnings: ParseWarning[] = [...parsed.warnings];

  // 헤더/시트 자체 오류면 즉시 반환 (rowIndex 0 또는 1)
  const fatal = errors.some((e) => e.rowIndex <= 1);
  if (fatal) {
    return NextResponse.json({
      success: false,
      code: 'PARSE_FAILED',
      data: {
        dryRun: true,
        companies: { count: 0, rows: [] },
        members: { count: 0, rows: [] },
        errors,
        warnings,
      },
      message: '엑셀 구조가 양식과 일치하지 않습니다. 시트명/헤더를 확인해 주세요.',
    }, { status: 400 });
  }

  // 같은 업체명이 엑셀 내에서 여러 번 등장하는 경우 → 마지막 행 우선 (upsert)
  const companyByName = new Map<string, CompanyRowInput>();
  for (const c of parsed.companies) {
    companyByName.set(c.name.toLowerCase(), c);
  }

  // 회원: 업체명 → 행 그룹화 (실제 upsert 시 company_id 매핑 후 처리)
  const memberRowsByCompanyName = new Map<string, MemberRowInput[]>();
  for (const m of parsed.members) {
    const key = m.companyName.toLowerCase();
    const arr = memberRowsByCompanyName.get(key) ?? [];
    arr.push(m);
    memberRowsByCompanyName.set(key, arr);
  }

  // 엑셀에 없지만 회원 시트에서 참조되는 업체는 신규 생성 후보로 만든다
  const referencedCompanyNames = Array.from(memberRowsByCompanyName.keys());
  const missingCompanyNames = referencedCompanyNames.filter(
    (k) => !companyByName.has(k)
  );

  // 미리보기 응답 데이터
  const previewCompanies = Array.from(companyByName.values()).map((c) => ({
    rowIndex: c.rowIndex,
    name: c.name,
    biz_no: c.bizNo,
    company_type: c.companyType,
    manager_name: c.managerName,
    phone: c.phone,
    address: c.address,
    tel: c.tel,
    status: c.status,
    note: c.note,
  }));
  const previewMembers = parsed.members.map((m) => ({
    rowIndex: m.rowIndex,
    member_type: m.memberType,
    company_name: m.companyName,
    name: m.name,
    birth_date: m.birthDate,
    phone: m.phone,
    vehicle_number: m.vehicleNumber,
    equipment_type: m.equipmentType,
    equipment_type_etc: m.equipmentTypeEtc,
    spec: m.spec,
    note: m.note,
  }));

  for (const missing of missingCompanyNames) {
    warnings.push({
      sheet: '인원',
      rowIndex: memberRowsByCompanyName.get(missing)?.[0]?.rowIndex ?? 0,
      message: `업체 시트에 없는 업체명 "${memberRowsByCompanyName.get(missing)?.[0]?.companyName}" → 신규 등록(검토중)으로 생성됩니다.`,
    });
  }

  const hasRowErrors = errors.some((e) => e.rowIndex > 1);

  // dryRun → 미리보기만. 행 오류가 있어도 실패 행만 제외하고 나머지는 반영 가능(결과에 "몇 행: 사유" 보고).
  if (dryRun) {
    return NextResponse.json({
      success: true,
      code: hasRowErrors ? 'HAS_ROW_ERRORS' : 'PREVIEW_OK',
      data: {
        dryRun: true,
        companies: { count: previewCompanies.length, rows: previewCompanies },
        members: { count: previewMembers.length, rows: previewMembers },
        errors,
        warnings,
      },
      message: hasRowErrors
        ? `오류 행 ${errors.filter((e) => e.rowIndex > 1).length}건은 반영되지 않습니다. 나머지만 반영하려면 [반영]을 누르세요.`
        : '검증 통과 — 미리보기',
    });
  }

  // ===== 실제 반영 =====
  const supabase = createServiceClient();

  // 1. 기존 업체 조회 (참조된 모든 업체명)
  const referencedAll = new Set<string>([
    ...Array.from(companyByName.keys()),
    ...referencedCompanyNames,
  ]);
  const referencedNames = Array.from(referencedAll).map(
    (k) => companyByName.get(k)?.name ?? memberRowsByCompanyName.get(k)?.[0]?.companyName ?? ''
  ).filter(Boolean);

  let existingByLowerName = new Map<string, { id: string; name: string }>();
  if (referencedNames.length > 0) {
    const { data: exList, error: exErr } = await supabase
      .from('companies')
      .select('id, name')
      .in('name', referencedNames);
    if (exErr) {
      console.error('[admin/companies/import] existing companies err:', exErr);
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: exErr.message },
        { status: 500 }
      );
    }
    (exList ?? []).forEach((c: { id: string; name: string }) =>
      existingByLowerName.set(c.name.toLowerCase(), c)
    );
  }

  // 2. 업체 upsert (기존 → UPDATE, 신규 → INSERT)
  const companyResults = { inserted: 0, updated: 0 };

  for (const c of companyByName.values()) {
    const existing = existingByLowerName.get(c.name.toLowerCase());
    if (existing) {
      const { error } = await supabase
        .from('companies')
        .update({
          biz_no: c.bizNo,
          company_type: c.companyType,
          manager_name: c.managerName,
          phone: c.phone,
          address: c.address,
          tel: c.tel,
          status: c.status,
          note: c.note,
        })
        .eq('id', existing.id);
      if (error) {
        console.error('[admin/companies/import] company update err:', error);
        return NextResponse.json(
          { success: false, code: 'UPDATE_FAILED', message: error.message },
          { status: 500 }
        );
      }
      companyResults.updated += 1;
    } else {
      const { data, error } = await supabase
        .from('companies')
        .insert({
          name: c.name,
          biz_no: c.bizNo,
          company_type: c.companyType,
          manager_name: c.managerName,
          phone: c.phone,
          address: c.address,
          tel: c.tel,
          status: c.status,
          created_by: 'ADMIN',
          note: c.note,
        })
        .select('id, name')
        .single();
      if (error || !data) {
        console.error('[admin/companies/import] company insert err:', error);
        return NextResponse.json(
          { success: false, code: 'INSERT_FAILED', message: error?.message ?? '저장 실패' },
          { status: 500 }
        );
      }
      existingByLowerName.set(data.name.toLowerCase(), data);
      companyResults.inserted += 1;
    }
  }

  // 3. 인원 시트에서 참조됐지만 업체 시트엔 없던 업체들 → REVIEW 로 신규 생성
  for (const missing of missingCompanyNames) {
    const firstRow = memberRowsByCompanyName.get(missing)?.[0];
    if (!firstRow) continue;
    if (existingByLowerName.has(missing)) continue;
    const { data, error } = await supabase
      .from('companies')
      .insert({
        name: firstRow.companyName,
        company_type: 'GENERAL',
        status: 'REVIEW',
        created_by: 'ADMIN',
        note: '엑셀 일괄 업로드 시 인원 시트에서 자동 생성',
      })
      .select('id, name')
      .single();
    if (error || !data) {
      console.error('[admin/companies/import] auto-create company err:', error);
      return NextResponse.json(
        { success: false, code: 'INSERT_FAILED', message: error?.message ?? '저장 실패' },
        { status: 500 }
      );
    }
    existingByLowerName.set(data.name.toLowerCase(), data);
    companyResults.inserted += 1;
  }

  // 4. 회원 upsert
  const memberResults = { inserted: 0, updated: 0, skipped: 0 };

  for (const m of parsed.members) {
    const company = existingByLowerName.get(m.companyName.toLowerCase());
    if (!company) {
      memberResults.skipped += 1;
      warnings.push({
        sheet: '인원',
        rowIndex: m.rowIndex,
        message: `업체를 찾을 수 없어 건너뜀: "${m.companyName}"`,
      });
      continue;
    }

    const baseValues = {
      company_id: company.id,
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

    // UNIQUE 매칭 키로 select → 있으면 update, 없으면 insert
    let q = supabase
      .from('company_members')
      .select('id')
      .eq('company_id', company.id)
      .eq('name', m.name);
    q = m.birthDate ? q.eq('birth_date', m.birthDate) : q.is('birth_date', null);
    q = m.normalizedPhone
      ? q.eq('normalized_phone', m.normalizedPhone)
      : q.is('normalized_phone', null);

    const { data: existing, error: selErr } = await q.maybeSingle();
    if (selErr) {
      console.error('[admin/companies/import] member select err:', selErr);
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: selErr.message },
        { status: 500 }
      );
    }
    if (existing) {
      const { error } = await supabase
        .from('company_members')
        .update(baseValues)
        .eq('id', existing.id);
      if (error) {
        console.error('[admin/companies/import] member update err:', error);
        return NextResponse.json(
          { success: false, code: 'UPDATE_FAILED', message: error.message },
          { status: 500 }
        );
      }
      memberResults.updated += 1;
    } else {
      const { error } = await supabase.from('company_members').insert(baseValues);
      if (error) {
        console.error('[admin/companies/import] member insert err:', error);
        return NextResponse.json(
          { success: false, code: 'INSERT_FAILED', message: error.message },
          { status: 500 }
        );
      }
      memberResults.inserted += 1;
    }
  }

  return NextResponse.json({
    success: true,
    code: 'IMPORTED',
    data: {
      dryRun: false,
      companies: companyResults,
      members: memberResults,
      // 실패(검증 불통과) 행은 반영 안 됨 — "몇 행: 사유" 목록으로 보고
      errors,
      warnings,
    },
    message: hasRowErrors
      ? `반영 완료. 단, 오류 행 ${errors.filter((e) => e.rowIndex > 1).length}건은 반영되지 않았습니다(아래 목록).`
      : '반영 완료.',
  });
}
