import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isCompanyType, validateCompanyInput, type CompanyType } from '@/lib/company';
import { isValidBizNo, formatBizNo } from '@/lib/bizno';
import { checkBizStatus } from '@/lib/bizno-server';
import { sendSms } from '@/lib/sms';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * GET /api/companies?keyword=<업체명>
 * 신청자 공개 검색.
 * - PII 미노출: id, name, company_type, status 만 반환.
 * - 사용중지(DISABLED) 업체는 검색 결과에서 제외.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const keyword = (url.searchParams.get('keyword') ?? '').trim();

    const supabase = createServiceClient();
    let q = supabase
      .from('companies')
      .select('id, name, company_type, status')
      .neq('status', 'DISABLED')
      .order('name', { ascending: true })
      .limit(50);

    if (keyword) {
      // PostgREST ilike escape — % 와 , 만 정리
      const safe = keyword.replace(/[%,]/g, ' ').trim();
      if (safe) q = q.ilike('name', `%${safe}%`);
    }

    const { data, error } = await q;
    if (error) {
      console.error('[api/companies GET] error:', error);
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: '업체 검색에 실패했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: { items: data ?? [] } });
  } catch (e) {
    console.error('[api/companies GET] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/companies
 * 신청자 공개 등록.
 * - 기본 status='REVIEW', created_by='APPLICANT'.
 * - 응답은 공개 요약(id, name, company_type, status)만.
 * Body: { name, companyType?, bizNo?, managerName?, phone?, note? }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';

    if (!name) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '업체명을 입력해 주세요.' },
        { status: 400 }
      );
    }
    if (name.length > 200) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '업체명이 너무 깁니다.' },
        { status: 400 }
      );
    }

    const companyType: CompanyType = isCompanyType(body.companyType)
      ? body.companyType
      : 'GENERAL';

    const bizNoRaw = typeof body.bizNo === 'string' ? body.bizNo.trim() : '';
    const managerNameRaw =
      typeof body.managerName === 'string' ? body.managerName.trim() : '';
    const phoneDigits =
      typeof body.phone === 'string' ? body.phone.replace(/[^0-9]/g, '') : '';
    const addressRaw = typeof body.address === 'string' ? body.address.trim().slice(0, 300) : '';
    const telDigits = typeof body.tel === 'string' ? body.tel.replace(/[^0-9]/g, '') : '';
    const noteRaw = typeof body.note === 'string' ? body.note.trim() : '';

    // 구분별 규칙(공개 등록 = 항상 REVIEW라 승인 필수 검사는 없음, 담당자 필수만)
    const vErrors = validateCompanyInput({
      companyType, name, managerName: managerNameRaw, phone: phoneDigits,
      targetStatus: 'REVIEW', bizNo: bizNoRaw, address: addressRaw, tel: telDigits,
    });
    if (vErrors.length > 0) {
      return NextResponse.json({ success: false, code: 'INVALID_INPUT', message: vErrors[0] }, { status: 400 });
    }
    // 사업자번호 입력 시 체크섬 필수(형식상 불가능한 번호 저장 거부)
    if (bizNoRaw && !isValidBizNo(bizNoRaw)) {
      return NextResponse.json(
        { success: false, code: 'INVALID_BIZNO', message: '형식상 불가능한 사업자번호입니다. 다시 확인해 주세요.' },
        { status: 400 }
      );
    }
    // 국세청 상태조회(키 설정 시, best-effort — 실패해도 등록 진행)
    let bizStatus: string | null = null;
    let bizCheckedAt: string | null = null;
    if (bizNoRaw) {
      const r = await checkBizStatus(bizNoRaw);
      if (r.checked) { bizStatus = r.label; bizCheckedAt = new Date().toISOString(); }
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('companies')
      .insert({
        name,
        biz_no: bizNoRaw ? formatBizNo(bizNoRaw) : null,
        company_type: companyType,
        manager_name: managerNameRaw || null,
        phone: phoneDigits || null,
        address: addressRaw || null,
        tel: telDigits || null,
        biz_status: bizStatus,
        biz_checked_at: bizCheckedAt,
        status: 'REVIEW',
        created_by: 'APPLICANT',
        note: noteRaw || null,
      })
      .select('id, name, company_type, status')
      .single();

    if (error || !data) {
      console.error('[api/companies POST] error:', error);
      return NextResponse.json(
        { success: false, code: 'SAVE_FAILED', message: '업체 등록에 실패했습니다.' },
        { status: 500 }
      );
    }

    // [R-5] 담당자 알림 — 신규 업체 신청 접수 (best-effort, 담당자 폰 = 발신번호와 동일)
    try {
      const managerPhone = process.env.SOLAPI_SENDER;
      if (managerPhone) {
        const sms = await sendSms(managerPhone, `[동남] 신규 업체 신청: ${name} (검토 필요)`);
        if (!sms.ok) console.error('[api/companies POST] notify sms failed:', sms.code, sms.message);
      }
    } catch (e) {
      console.error('[api/companies POST] notify sms unexpected:', e);
    }

    return NextResponse.json({ success: true, data });
  } catch (e) {
    console.error('[api/companies POST] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
