import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * POST /api/lookup
 * 기존 수료 여부 조회 (폰 + 생년월일 + 성명).
 * - 입력값 정규화 (전화번호 숫자만, 이름 trim)
 * - Supabase error 를 삼키지 않고 그대로 반환 (진단 가능)
 * - training_sessions → completions 를 단계별로 조회해 원인 추적 가능
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const rawName: string = body?.name ?? '';
    const rawPhone: string = body?.phone ?? '';
    const rawBirth: string = body?.birthDate ?? '';

    const name = rawName.trim();
    const phone = rawPhone.replace(/[^0-9]/g, '');
    const birthDate = rawBirth.trim();

    if (!name || !phone || !birthDate) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '필수 정보가 누락되었습니다.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // 1. training_sessions 조회
    const { data: sessions, error: sessionsErr } = await supabase
      .from('training_sessions')
      .select(
        `id, name, affiliation, birth_date, phone, vehicle_number, target_type_id, course_id, created_at,
         target_types ( code, label )`
      )
      .eq('phone', phone)
      .eq('birth_date', birthDate)
      .eq('name', name)
      .order('created_at', { ascending: false });

    if (sessionsErr) {
      console.error('[lookup] sessions query error:', sessionsErr);
      return NextResponse.json(
        {
          success: false,
          code: 'SESSIONS_QUERY_FAILED',
          message: sessionsErr.message,
          details: sessionsErr,
        },
        { status: 500 }
      );
    }

    if (!sessions || sessions.length === 0) {
      return NextResponse.json({
        success: true,
        data: { status: 'NONE', reason: 'NO_SESSION' },
      });
    }

    // 2. completions 조회 (session_id 기준)
    const sessionIds = sessions.map((s) => s.id);
    const { data: completions, error: completionsErr } = await supabase
      .from('completions')
      .select('id, session_id, completion_number, completed_at, expires_at, score')
      .in('session_id', sessionIds)
      .order('completed_at', { ascending: false });

    if (completionsErr) {
      console.error('[lookup] completions query error:', completionsErr);
      return NextResponse.json(
        {
          success: false,
          code: 'COMPLETIONS_QUERY_FAILED',
          message: completionsErr.message,
          details: completionsErr,
        },
        { status: 500 }
      );
    }

    if (!completions || completions.length === 0) {
      return NextResponse.json({
        success: true,
        data: { status: 'NONE', reason: 'NO_COMPLETION' },
      });
    }

    const latest = completions[0];
    const session =
      sessions.find((s) => s.id === latest.session_id) || sessions[0];

    const expiresAt = new Date(latest.expires_at);
    const now = new Date();
    const isValid = now < expiresAt;

    const phoneDigits = (session.phone || '').replace(/[^0-9]/g, '');
    const phoneMasked =
      phoneDigits.length >= 10
        ? `${phoneDigits.slice(0, 3)}-****-${phoneDigits.slice(-4)}`
        : session.phone;
    const birthYear = session.birth_date
      ? session.birth_date.substring(0, 4)
      : null;

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
  } catch (e: any) {
    console.error('[lookup] unexpected error:', e);
    return NextResponse.json(
      {
        success: false,
        code: 'SERVER_ERROR',
        message: e?.message ?? '서버 오류가 발생했습니다.',
      },
      { status: 500 }
    );
  }
}
