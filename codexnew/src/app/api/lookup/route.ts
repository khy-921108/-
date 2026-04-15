import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * POST /api/lookup
 * 기존 수료 여부 조회 (폰 + 생년월일 + 성명).
 * - 결과: NONE / VALID / EXPIRED
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

    // 가장 최근 세션 + 연결된 수료 조회
    const { data: sessions } = await supabase
      .from('training_sessions')
      .select('id, name, target_type_id, course_id, created_at')
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
    const expiresAt = new Date(latest.expires_at);
    const now = new Date();
    const isValid = now < expiresAt;

    return NextResponse.json({
      success: true,
      data: {
        status: isValid ? 'VALID' : 'EXPIRED',
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
