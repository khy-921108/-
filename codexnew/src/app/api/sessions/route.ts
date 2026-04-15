import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * POST /api/sessions
 * 기본정보 입력 후 교육 세션 생성.
 * 주의: 호출 전 /api/lookup 으로 기존 유효 수료 먼저 확인할 것.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { affiliation, name, birthDate, phone, targetTypeCode, consentYn } = body;

    if (!affiliation || !name || !birthDate || !phone || !targetTypeCode) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '필수 정보가 누락되었습니다.' },
        { status: 400 }
      );
    }

    if (!consentYn) {
      return NextResponse.json(
        { success: false, code: 'CONSENT_REQUIRED', message: '개인정보 수집에 동의해야 합니다.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // 대상 유형 조회
    const { data: targetType } = await supabase
      .from('target_types')
      .select('id')
      .eq('code', targetTypeCode)
      .single();

    if (!targetType) {
      return NextResponse.json(
        { success: false, code: 'INVALID_TARGET_TYPE', message: '대상 구분이 올바르지 않습니다.' },
        { status: 400 }
      );
    }

    // 대상별 활성 과정 조회
    const { data: course } = await supabase
      .from('courses')
      .select('id, version')
      .eq('target_type_id', targetType.id)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (!course) {
      return NextResponse.json(
        { success: false, code: 'NO_ACTIVE_COURSE', message: '활성화된 교육 과정이 없습니다.' },
        { status: 400 }
      );
    }

    // 세션 생성
    const { data: session, error } = await supabase
      .from('training_sessions')
      .insert({
        affiliation,
        name,
        birth_date: birthDate,
        phone,
        target_type_id: targetType.id,
        course_id: course.id,
        consent_yn: true,
        status: 'IN_PROGRESS',
      })
      .select()
      .single();

    if (error || !session) {
      console.error(error);
      return NextResponse.json(
        { success: false, code: 'SAVE_FAILED', message: '세션 생성에 실패했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        sessionId: session.id,
        courseId: course.id,
        status: 'IN_PROGRESS',
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
