import { normalizeKrPhone } from '@/lib/phone';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { maskPhone } from '@/lib/format';
import { ApplicantQueryError, resolveApplicantCompany } from '@/lib/applicant-company';

/**
 * POST /api/work-permits/verify-applicant  (공개) — STEP1 진입 게이트
 * req: { name, birthDate, phone }
 * res: { success, data:{ status:'OK'|'NO_EDU'|'NO_COMPANY', name, company:{id,name}|null,
 *                        completedAt?, expiresAt?, phoneMasked } }
 *
 * - OK       = 유효 수료(completions, now 기준) 있음 AND training_sessions.company_id 연결됨
 * - NO_EDU   = 유효 수료 없음 → "교육 먼저"
 * - NO_COMPANY = 수료는 있으나 업체 미연결·사용중지·숨김 → "업체 등록 먼저"
 * 판정은 lib/applicant-company 공용 함수(업체 수료자 불러오기와 같은 기준).
 * - 명단 덤프 없음(본인 1명). 연락처 마스킹.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = (typeof body.name === 'string' ? body.name : '').trim();
    const birthDate = (typeof body.birthDate === 'string' ? body.birthDate : '').trim();
    const phone = normalizeKrPhone(typeof body.phone === 'string' ? body.phone : '');

    if (!name || !birthDate || !phone) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '이름·생년월일·연락처를 입력해 주세요.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const phoneMasked = maskPhone(phone);
    const who = await resolveApplicantCompany(supabase, { name, birthDate, phone });

    if (who.status === 'NO_EDU') {
      return NextResponse.json({
        success: true,
        data: { status: 'NO_EDU', name, company: null, phoneMasked },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        status: who.status,
        name,
        company: who.status === 'OK' ? who.company : null,
        completedAt: who.completedAt,
        expiresAt: who.expiresAt,
        phoneMasked,
      },
    });
  } catch (e) {
    if (e instanceof ApplicantQueryError) {
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: '조회 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }
    console.error('[verify-applicant] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
