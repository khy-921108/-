import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getSettings } from '@/lib/settings';
import { generateCompletionNumber } from '@/lib/completion-number';

/**
 * POST /api/sessions/:id/complete
 * 수료 최종 처리.
 * 서버 검증 → completions INSERT (UNIQUE 제약으로 중복 차단).
 */
export async function POST(_req: Request, ctx: { params: { id: string } }) {
  try {
    const sessionId = ctx.params.id;
    const supabase = createServiceClient();

    // 1. 세션 확인
    const { data: session } = await supabase
      .from('training_sessions')
      .select('id, target_type_id, course_id, video_completed_yn')
      .eq('id', sessionId)
      .single();

    if (!session) {
      return NextResponse.json(
        { success: false, code: 'SESSION_NOT_FOUND', message: '세션을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // 이미 수료 이력이 있는 경우 — UNIQUE 제약 방어
    const { data: existing } = await supabase
      .from('completions')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        success: true,
        data: {
          completionId: existing.id,
          completionNumber: existing.completion_number,
          completedAt: existing.completed_at,
          validUntil: existing.expires_at,
          alreadyCompleted: true,
        },
      });
    }

    // 2. 영상 완료 검증
    if (!session.video_completed_yn) {
      return NextResponse.json(
        { success: false, code: 'VIDEO_NOT_COMPLETED', message: '영상 시청을 완료하세요.' },
        { status: 400 }
      );
    }

    // 3. 최신 시험 합격 검증
    const { data: latestExam } = await supabase
      .from('exam_results')
      .select('id, score, passed_yn')
      .eq('session_id', sessionId)
      .order('attempted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestExam || !latestExam.passed_yn) {
      return NextResponse.json(
        { success: false, code: 'EXAM_NOT_PASSED', message: '시험 합격 이력이 없습니다.' },
        { status: 400 }
      );
    }

    // 4. 과정 버전 스냅샷
    const { data: course } = await supabase
      .from('courses')
      .select('version')
      .eq('id', session.course_id)
      .single();

    const settings = await getSettings();
    const validMonths = parseInt(settings.VALID_MONTHS, 10);
    const prefix = settings.COMPLETION_PREFIX;

    const completedAt = new Date();
    const expiresAt = new Date(completedAt);
    expiresAt.setMonth(expiresAt.getMonth() + validMonths);

    const completionNumber = await generateCompletionNumber(prefix);

    // 5. INSERT (UNIQUE 충돌 시 기존 반환)
    const { data: completion, error } = await supabase
      .from('completions')
      .insert({
        session_id: sessionId,
        target_type_id: session.target_type_id,
        course_id: session.course_id,
        course_version: course?.version ?? 1,
        exam_result_id: latestExam.id,
        completion_number: completionNumber,
        completed_at: completedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        score: latestExam.score,
      })
      .select()
      .single();

    if (error) {
      // UNIQUE violation → 재조회
      if (error.code === '23505') {
        const { data: existingAfter } = await supabase
          .from('completions')
          .select('*')
          .eq('session_id', sessionId)
          .single();
        if (existingAfter) {
          return NextResponse.json({
            success: true,
            data: {
              completionId: existingAfter.id,
              completionNumber: existingAfter.completion_number,
              completedAt: existingAfter.completed_at,
              validUntil: existingAfter.expires_at,
              alreadyCompleted: true,
            },
          });
        }
      }
      console.error(error);
      return NextResponse.json(
        { success: false, code: 'SAVE_FAILED', message: '수료 저장 실패' },
        { status: 500 }
      );
    }

    // 6. 세션 상태 COMPLETED
    await supabase
      .from('training_sessions')
      .update({ status: 'COMPLETED' })
      .eq('id', sessionId);

    return NextResponse.json({
      success: true,
      data: {
        completionId: completion.id,
        completionNumber: completion.completion_number,
        completedAt: completion.completed_at,
        validUntil: completion.expires_at,
        score: completion.score,
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
