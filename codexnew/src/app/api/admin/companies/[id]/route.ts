import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { isCompanyType, isCompanyStatus, validateCompanyInput, enforceCompanyName, type CompanyType } from '@/lib/company';
import { isValidBizNo, formatBizNo } from '@/lib/bizno';
import { checkBizStatus } from '@/lib/bizno-server';
import { sendSms } from '@/lib/sms';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * GET /api/admin/companies/:id
 * 단건 조회. 어드민 전용.
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission('COMPANIES_VIEW');
  if (!auth.ok) return auth.response;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('id', ctx.params.id)
    .maybeSingle();

  if (error) {
    console.error('[admin/companies/:id GET]', error);
    return NextResponse.json(
      { success: false, code: 'QUERY_FAILED', message: error.message },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json(
      { success: false, code: 'NOT_FOUND', message: '업체를 찾을 수 없습니다.' },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true, data });
}

/**
 * PATCH /api/admin/companies/:id
 * 업체명/사업자번호/구분/담당자/연락처/상태/비고 수정.
 * 어드민 전용. 병합 기능은 1A에서 제외.
 * Body: { name?, bizNo?, companyType?, managerName?, phone?, status?, note? }
 */
export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission('COMPANIES_EDIT');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const update: Record<string, unknown> = {};

    if (typeof body.name === 'string') {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json(
          { success: false, code: 'INVALID_INPUT', message: '업체명은 비어 있을 수 없습니다.' },
          { status: 400 }
        );
      }
      if (name.length > 200) {
        return NextResponse.json(
          { success: false, code: 'INVALID_INPUT', message: '업체명이 너무 깁니다.' },
          { status: 400 }
        );
      }
      update.name = name;
    }

    if (typeof body.bizNo === 'string') {
      const bn = body.bizNo.trim();
      // 사업자번호 입력 시 체크섬 필수(형식상 불가능한 번호 저장 거부)
      if (bn && !isValidBizNo(bn)) {
        return NextResponse.json(
          { success: false, code: 'INVALID_BIZNO', message: '형식상 불가능한 사업자번호입니다. 다시 확인해 주세요.' },
          { status: 400 }
        );
      }
      update.biz_no = bn ? formatBizNo(bn) : null;
    }

    if (typeof body.address === 'string') {
      update.address = body.address.trim().slice(0, 300) || null;
    }
    if (typeof body.tel === 'string') {
      const t = body.tel.replace(/[^0-9]/g, '');
      update.tel = t || null;
    }

    if (body.companyType !== undefined) {
      if (!isCompanyType(body.companyType)) {
        return NextResponse.json(
          { success: false, code: 'INVALID_INPUT', message: '업체 구분이 올바르지 않습니다.' },
          { status: 400 }
        );
      }
      update.company_type = body.companyType;
    }

    if (typeof body.managerName === 'string') {
      update.manager_name = body.managerName.trim() || null;
    }

    if (typeof body.phone === 'string') {
      const digits = body.phone.replace(/[^0-9]/g, '');
      update.phone = digits || null;
    }

    if (body.status !== undefined) {
      if (!isCompanyStatus(body.status)) {
        return NextResponse.json(
          { success: false, code: 'INVALID_INPUT', message: '상태값이 올바르지 않습니다.' },
          { status: 400 }
        );
      }
      update.status = body.status;
    }

    if (typeof body.note === 'string') {
      update.note = body.note.trim() || null;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { success: false, code: 'NOTHING_TO_UPDATE', message: '변경할 항목이 없습니다.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // 변경 전 레코드(상태 통지 + 승인 필수 검사용 병합 기준)
    const { data: before } = await supabase
      .from('companies')
      .select('status, company_type, name, manager_name, phone, biz_no, address, tel')
      .eq('id', ctx.params.id)
      .maybeSingle();
    if (!before) {
      return NextResponse.json(
        { success: false, code: 'NOT_FOUND', message: '업체를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // 병합 후 값 기준으로 공용 검증(다른 문 3개와 동일 규칙 — validateCompanyInput + 체크섬 항상)
    const merged = {
      company_type: (update.company_type as string) ?? before.company_type,
      name: (update.name as string) ?? before.name,
      manager_name: update.manager_name !== undefined ? (update.manager_name as string | null) : before.manager_name,
      phone: update.phone !== undefined ? (update.phone as string | null) : before.phone,
      biz_no: update.biz_no !== undefined ? (update.biz_no as string | null) : before.biz_no,
      address: update.address !== undefined ? (update.address as string | null) : before.address,
      tel: update.tel !== undefined ? (update.tel as string | null) : before.tel,
      status: (update.status as string) ?? before.status,
    };
    // 개인작업자 = "개인(이름)" 형식 서버 강제
    if (merged.company_type === 'INDIVIDUAL') {
      const forced = enforceCompanyName('INDIVIDUAL', merged.name ?? '');
      if (!forced) {
        return NextResponse.json(
          { success: false, code: 'INVALID_INPUT', message: '개인작업자는 이름이 필요합니다(개인(이름) 형식).' },
          { status: 400 }
        );
      }
      merged.name = forced;
      update.name = forced;
    }
    const vErrors = validateCompanyInput({
      companyType: merged.company_type as CompanyType,
      name: merged.name ?? '',
      managerName: merged.manager_name,
      phone: merged.phone,
      targetStatus: merged.status,
      bizNo: merged.biz_no,
      address: merged.address,
      tel: merged.tel,
    });
    if (vErrors.length > 0) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: vErrors[0] },
        { status: 400 }
      );
    }
    // 체크섬: 병합 결과에 항상 적용 — 체크섬 틀린 기존 번호를 안고는 승인·수정 불가(수정으로 고치게)
    if ((merged.biz_no ?? '').trim() && !isValidBizNo(merged.biz_no)) {
      return NextResponse.json(
        { success: false, code: 'INVALID_BIZNO', message: '저장된 사업자번호가 형식상 불가능합니다. 사업자번호를 함께 수정해 주세요.' },
        { status: 400 }
      );
    }

    // 사업자번호가 새로 들어오면 국세청 재확인(best-effort)
    if (typeof update.biz_no === 'string' && update.biz_no && update.biz_no !== before.biz_no) {
      const r = await checkBizStatus(update.biz_no);
      if (r.checked) {
        update.biz_status = r.label;
        update.biz_checked_at = new Date().toISOString();
      }
    }

    // [R-2] 관리자 화면에서 상태를 바꾸는 경우에도 처리자/시각 기록
    if (typeof update.status === 'string' && update.status !== before.status) {
      update.status_changed_by = auth.admin.email;
      update.status_changed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('companies')
      .update(update)
      .eq('id', ctx.params.id)
      .select()
      .single();

    if (error) {
      console.error('[admin/companies/:id PATCH]', error);
      return NextResponse.json(
        { success: false, code: 'UPDATE_FAILED', message: error.message },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { success: false, code: 'NOT_FOUND', message: '업체를 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // [R-5] 검토중→정식등록/사용중지 전환 시 담당자 통지 — best-effort
    try {
      if (
        before?.status === 'REVIEW' &&
        typeof update.status === 'string' &&
        (update.status === 'ACTIVE' || update.status === 'DISABLED') &&
        data.phone
      ) {
        const msg =
          update.status === 'ACTIVE'
            ? `[동남] ${data.name} 업체 등록이 승인되었습니다.`
            : `[동남] ${data.name} 업체 등록이 반려되었습니다. 문의: 안전보건팀`;
        const sms = await sendSms(data.phone, msg);
        if (!sms.ok) console.error('[admin/companies PATCH] sms failed:', sms.code, sms.message);
      }
    } catch (e) {
      console.error('[admin/companies PATCH] sms unexpected:', e);
    }

    return NextResponse.json({ success: true, data });
  } catch (e) {
    console.error('[admin/companies/:id PATCH] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
