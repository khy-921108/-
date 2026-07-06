import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { isCompanyType, isCompanyStatus, type CompanyType } from '@/lib/company';

/**
 * GET /api/admin/companies?keyword=&type=&status=
 * 어드민 업체 목록/검색 + 기본 통계.
 * - requireAdmin() 필수.
 * - 전체 필드(PII 포함) 반환.
 * - 통계: 총건수, 상태별 건수.
 */
export async function GET(req: Request) {
  const auth = await requirePermission('COMPANIES_VIEW');
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const keyword = (url.searchParams.get('keyword') ?? '').trim();
  const typeParam = url.searchParams.get('type');
  const statusParam = url.searchParams.get('status');

  const supabase = createServiceClient();
  let q = supabase
    .from('companies')
    .select(
      'id, name, biz_no, company_type, manager_name, phone, status, created_by, note, created_at, updated_at'
    )
    .order('created_at', { ascending: false })
    .limit(500);

  if (keyword) {
    const safe = keyword.replace(/[%,]/g, ' ').trim();
    if (safe) {
      q = q.or(`name.ilike.%${safe}%,manager_name.ilike.%${safe}%`);
    }
  }
  if (typeParam && isCompanyType(typeParam)) q = q.eq('company_type', typeParam);
  if (statusParam && isCompanyStatus(statusParam)) q = q.eq('status', statusParam);

  const { data: items, error } = await q;
  if (error) {
    console.error('[admin/companies GET] error:', error);
    return NextResponse.json(
      { success: false, code: 'QUERY_FAILED', message: error.message },
      { status: 500 }
    );
  }

  // 상태별 통계 (필터와 무관한 전체 통계)
  const { data: statusRows } = await supabase.from('companies').select('status');
  const stats = { total: 0, review: 0, active: 0, disabled: 0 };
  (statusRows ?? []).forEach((r: { status: string }) => {
    stats.total += 1;
    if (r.status === 'REVIEW') stats.review += 1;
    else if (r.status === 'ACTIVE') stats.active += 1;
    else if (r.status === 'DISABLED') stats.disabled += 1;
  });

  return NextResponse.json({
    success: true,
    data: { items: items ?? [], stats },
  });
}

/**
 * POST /api/admin/companies
 * 어드민 직접 등록 (검토중 단계 생략 가능 → 기본 ACTIVE).
 * Body: { name, companyType?, bizNo?, managerName?, phone?, status?, note? }
 */
export async function POST(req: Request) {
  const auth = await requirePermission('COMPANIES_EDIT');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '업체명을 입력해 주세요.' },
        { status: 400 }
      );
    }

    const companyType: CompanyType = isCompanyType(body.companyType)
      ? body.companyType
      : 'GENERAL';
    const status = isCompanyStatus(body.status) ? body.status : 'ACTIVE';

    const bizNoRaw = typeof body.bizNo === 'string' ? body.bizNo.trim() : '';
    const managerNameRaw =
      typeof body.managerName === 'string' ? body.managerName.trim() : '';
    const phoneDigits =
      typeof body.phone === 'string' ? body.phone.replace(/[^0-9]/g, '') : '';
    const noteRaw = typeof body.note === 'string' ? body.note.trim() : '';

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('companies')
      .insert({
        name,
        biz_no: bizNoRaw || null,
        company_type: companyType,
        manager_name: managerNameRaw || null,
        phone: phoneDigits || null,
        status,
        created_by: 'ADMIN',
        note: noteRaw || null,
      })
      .select()
      .single();

    if (error || !data) {
      console.error('[admin/companies POST] error:', error);
      return NextResponse.json(
        { success: false, code: 'SAVE_FAILED', message: error?.message ?? '저장 실패' },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true, data });
  } catch (e) {
    console.error('[admin/companies POST] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
