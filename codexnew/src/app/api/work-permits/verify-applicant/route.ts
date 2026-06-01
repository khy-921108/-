import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { maskPhone } from '@/lib/format';

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

    const { data: company } = await supabase
      .from('companies')
      .select('id, name, status')
      .eq('id', companyId)
      .maybeSingle();

    if (!company || company.status === 'DISABLED') {
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
