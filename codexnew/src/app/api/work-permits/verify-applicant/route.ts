import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { maskPhone } from '@/lib/format';

/**
 * POST /api/work-permits/verify-applicant  (공개) — STEP1 진입 게이트
 * req: { name, birthDate, phone }
 * res: { success, data:{ status:'OK'|'NO_EDU'|'NO_COMPANY', name, company:{id,name}|null,
 *                        completedAt?, expiresAt?, phoneMasked } }
 *
 * - OK       = 유효 수료(completions, now 기준) 있음 AND training_sessions.company_id 연결됨
 * - NO_EDU   = 유효 수료 없음 → "교육 먼저"
 * - NO_COMPANY = 수료는 있으나 업체 미연결 → "업체 등록 먼저"
 * - 명단 덤프 없음(본인 1명). 연락처 마스킹.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = (typeof body.name === 'string' ? body.name : '').trim();
    const birthDate = (typeof body.birthDate === 'string' ? body.birthDate : '').trim();
    const phone = (typeof body.phone === 'string' ? body.phone : '').replace(/[^0-9]/g, '');

    if (!name || !birthDate || !phone) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '이름·생년월일·연락처를 입력해 주세요.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // 1. 본인 세션(이름+생년월일+전화)
    const { data: sessions, error: sessErr } = await supabase
      .from('training_sessions')
      .select('id, name, affiliation, company_id, created_at')
      .eq('phone', phone)
      .eq('birth_date', birthDate)
      .eq('name', name)
      .order('created_at', { ascending: false });

    if (sessErr) {
      console.error('[verify-applicant] sessions:', sessErr);
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: '조회 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }

    const phoneMasked = maskPhone(phone);

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({
        success: true,
        data: { status: 'NO_EDU', name, company: null, phoneMasked },
      });
    }

    // 2. 유효 수료 확인 (now 기준 — 진입 게이트는 "교육을 마쳤는가")
    const sessionIds = sessions.map((s: any) => s.id);
    const { data: comps, error: compErr } = await supabase
      .from('completions')
      .select('session_id, completed_at, expires_at')
      .in('session_id', sessionIds)
      .order('completed_at', { ascending: false });

    if (compErr) {
      console.error('[verify-applicant] completions:', compErr);
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: '조회 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }

    const now = Date.now();
    const validComp = (comps ?? []).find(
      (c: any) => new Date(c.expires_at).getTime() > now
    );

    if (!validComp) {
      return NextResponse.json({
        success: true,
        data: { status: 'NO_EDU', name, company: null, phoneMasked },
      });
    }

    // 3. 업체 연결 확인 — 유효 수료가 속한 세션의 company_id 우선, 없으면 최근 세션 중 company_id 보유분
    const validSession =
      sessions.find((s: any) => s.id === validComp.session_id) ?? sessions[0];
    let companyId: string | null = validSession.company_id ?? null;
    if (!companyId) {
      const withCompany = sessions.find((s: any) => s.company_id);
      companyId = withCompany?.company_id ?? null;
    }

    if (!companyId) {
      return NextResponse.json({
        success: true,
        data: {
          status: 'NO_COMPANY',
          name,
          company: null,
          completedAt: validComp.completed_at,
          expiresAt: validComp.expires_at,
          phoneMasked,
        },
      });
    }

    // 4. 업체 정보(공개 최소 필드)
    const { data: company } = await supabase
      .from('companies')
      .select('id, name, status')
      .eq('id', companyId)
      .maybeSingle();

    if (!company || company.status === 'DISABLED') {
      // 업체가 사용중지/삭제면 업체 재선택 유도
      return NextResponse.json({
        success: true,
        data: {
          status: 'NO_COMPANY',
          name,
          company: null,
          completedAt: validComp.completed_at,
          expiresAt: validComp.expires_at,
          phoneMasked,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        status: 'OK',
        name,
        company: { id: company.id, name: company.name },
        completedAt: validComp.completed_at,
        expiresAt: validComp.expires_at,
        phoneMasked,
      },
    });
  } catch (e) {
    console.error('[verify-applicant] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
