import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getSettingInt } from '@/lib/settings';

/**
 * GET /api/sessions/:id/exam
 * 대상별 활성 시험 문항 중 N개 랜덤 추출 (정답 제외).
 * 영상 100% 미완료 시 차단.
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const sessionId = ctx.params.id;
    const supabase = createServiceClient();

    const { data: session } = await supabase
      .from('training_sessions')
      .select('target_type_id, video_completed_yn')
      .eq('id', sessionId)
      .single();

    if (!session) {
      return NextResponse.json(
        { success: false, code: 'SESSION_NOT_FOUND', message: '세션을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    if (!session.video_completed_yn) {
      return NextResponse.json(
        {
          success: false,
          code: 'VIDEO_NOT_COMPLETED',
          message: '교육 영상 시청을 먼저 완료해야 합니다.',
        },
        { status: 400 }
      );
    }

    const quizCount = await getSettingInt('QUIZ_COUNT');

    const { data: questions } = await supabase
      .from('questions')
      .select('id, question_text, option_1, option_2, option_3, option_4')
      .eq('target_type_id', session.target_type_id)
      .eq('is_active', true);

    if (!questions || questions.length === 0) {
      return NextResponse.json(
        { success: false, code: 'NO_QUESTIONS', message: '등록된 문제가 없습니다.' },
        { status: 400 }
      );
    }

    // 랜덤 셔플 후 N개 선택
    const shuffled = [...questions].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.min(quizCount, shuffled.length));

    const clientQuestions = selected.map((q, idx) => ({
      questionId: q.id,
      questionNo: idx + 1,
      questionText: q.question_text,
      options: [
        { no: 1, text: q.option_1 },
        { no: 2, text: q.option_2 },
        { no: 3, text: q.option_3 },
        { no: 4, text: q.option_4 },
      ].sort(() => Math.random() - 0.5), // 선택지도 셔플
    }));

    return NextResponse.json({
      success: true,
      data: {
        questionCount: clientQuestions.length,
        questions: clientQuestions,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류' },
      { status: 500 }
    );
  }
}
