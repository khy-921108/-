import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * POST /api/lookup
 * 기존 수료 여부 조회 (폰 + 생년월일 + 성명).
 * - 결과: NONE / VALID / EXPIRED
 * - VALID/EXPIRED 시 이름·소속·차량번호·교육구분·마스킹 연락처 등 추가 반환 (출입증 화면용)
 */
export async function POST(req: Request) {
  try {
    const { phone, birthDate, name } = await req.json();

    if (!phone || !birthDate || !name) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '필수 정보가 누락되었습니다.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // 가장 최근 세션 + 연결된 수료 조회 (target_types JOIN)
    const { data: sessions } = await supabase
      .from('training_sessions')
      .select(
        `id, name, affiliation, birth_date, phone, vehicle_number, target_type_id, course_id, created_at,
         target_types ( code, label )`
      )
      .eq('phone', phone)
      .eq('birth_date', birthDate)
      .eq('name', name)
      .order('created_at', { ascending: false });

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({
        success: true,
        data: { status: 'NONE' },
      });
    }

    const sessionIds = sessions.map((s) => s.id);

    const { data: completions } = await supabase
      .from('completions')
      .select('*')
      .in('session_id', sessionIds)
      .order('completed_at', { ascending: false });

    if (!completions || completions.length === 0) {
      return NextResponse.json({
        success: true,
        data: { status: 'NONE' },
      });
    }

    const latest = completions[0];
    const session =
      sessions.find((s) => s.id === latest.session_id) || sessions[0];

    const expiresAt = new Date(latest.expires_at);
    const now = new Date();
    const isValid = now < expiresAt;

    // 개인정보 마스킹 (서버에서 처리)
    const phoneDigits = (session.phone || '').replace(/[^0-9]/g, '');
    const phoneMasked =
      phoneDigits.length >= 10
        ? `${phoneDigits.slice(0, 3)}-****-${phoneDigits.slice(-4)}`
        : session.phone;
    const birthYear = session.birth_date
      ? session.birth_date.substring(0, 4)
      : null;

    // Supabase JOIN 결과가 배열 또는 객체로 올 수 있음
    const targetTypes = Array.isArray(session.target_types)
      ? session.target_types[0]
      : session.target_types;

    return NextResponse.json({
      success: true,
      data: {
        status: isValid ? 'VALID' : 'EXPIRED',
        name: session.name,
        affiliation: session.affiliation,
        vehicleNumber: session.vehicle_number,
        targetCode: targetTypes?.code ?? null,
        targetLabel: targetTypes?.label ?? null,
        birthYear,
        phoneMasked,
        score: latest.score,
        completionNumber: latest.completion_number,
        completedAt: latest.completed_at,
        validUntil: latest.expires_at,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
