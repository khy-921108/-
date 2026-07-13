import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { isCompanyType, isCompanyStatus } from '@/lib/company';
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
      update.biz_no = body.bizNo.trim() || null;
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

    // [R-5] 상태 전환 통지 대비 — 변경 전 상태 조회
    const { data: before } = await supabase
      .from('companies')
      .select('status')
      .eq('id', ctx.params.id)
      .maybeSingle();

    // [R-2] 관리자 화면에서 상태를 바꾸는 경우에도 처리자/시각 기록
    if (typeof update.status === 'string' && before && update.status !== before.status) {
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
