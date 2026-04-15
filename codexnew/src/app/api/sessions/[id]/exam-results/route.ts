import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getSettingInt } from '@/lib/settings';

interface Answer {
  questionId: number;
  selectedOption: number; // 1~4
}

/**
 * POST /api/sessions/:id/exam-results
 * 답안 제출 → 서버 채점 → exam_results 저장.
 */
export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const sessionId = ctx.params.id;
    const { answers } = (await req.json()) as { answers: Answer[] };

    if (!Array.isArray(answers) || answers.length === 0) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '답안이 비어있습니다.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const { data: session } = await supabase
      .from('training_sessions')
      .select('id, target_type_id, video_completed_yn')
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
        { success: false, code: 'VIDEO_NOT_COMPLETED', message: '영상 시청을 먼저 완료해주세요.' },
        { status: 400 }
      );
    }

    const questionIds = answers.map((a) => a.questionId);
    const { data: questions } = await supabase
      .from('questions')
      .select('id, correct_option, question_text, option_1, option_2, option_3, option_4, explanation')
      .in('id', questionIds);

    const questionMap = new Map((questions ?? []).map((q) => [q.id, q]));

    // 채점
    const graded = answers.map((a) => {
      const q = questionMap.get(a.questionId);
      const correct = q ? q.correct_option === a.selectedOption : false;
      return {
        questionId: a.questionId,
        selectedOption: a.selectedOption,
        correctOption: q?.correct_option ?? null,
        isCorrect: correct,
        questionText: q?.question_text ?? '',
        options: q
          ? [q.option_1, q.option_2, q.option_3, q.option_4]
          : [],
        explanation: q?.explanation ?? null,
      };
    });

    const correctCount = graded.filter((g) => g.isCorrect).length;
    const threshold = await getSettingInt('PASS_THRESHOLD');
    const passed = correctCount >= threshold;

    // 응시 횟수 계산
    const { count: prevCount } = await supabase
      .from('exam_results')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId);

    const attemptNumber = (prevCount ?? 0) + 1;

    const { data: examResult, error } = await supabase
      .from('exam_results')
      .insert({
        session_id: sessionId,
        attempt_number: attemptNumber,
        score: correctCount,
        passed_yn: passed,
        answers: graded.map((g) => ({
          questionId: g.questionId,
          selected: g.selectedOption,
          correct: g.correctOption,
          isCorrect: g.isCorrect,
        })),
      })
      .select()
      .single();

    if (error || !examResult) {
      console.error(error);
      return NextResponse.json(
        { success: false, code: 'SAVE_FAILED', message: '시험 결과 저장 실패' },
        { status: 500 }
      );
    }

    // 불합격 시 세션 상태 FAILED 업데이트 (합격은 /complete 에서 COMPLETED 로)
    if (!passed) {
      await supabase
        .from('training_sessions')
        .update({ status: 'FAILED' })
        .eq('id', sessionId);
    }

    return NextResponse.json({
      success: true,
      data: {
        examResultId: examResult.id,
        score: correctCount,
        totalQuestions: answers.length,
        passThreshold: threshold,
        passedYn: passed,
        attemptNumber,
        // 오답 확인 용
        reviews: graded.map((g) => ({
          questionText: g.questionText,
          options: g.options,
          selectedOption: g.selectedOption,
          correctOption: g.correctOption,
          isCorrect: g.isCorrect,
          explanation: g.explanation,
        })),
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
