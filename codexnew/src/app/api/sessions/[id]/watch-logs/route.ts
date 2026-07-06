import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getSettingInt } from '@/lib/settings';

/**
 * POST /api/sessions/:id/watch-logs
 * 영상 시청 로그 저장 (upsert). 완료 판정은 서버에서 재확인.
 */
export async function POST(req: Request, ctx: { params: { id: string } }) {
  try {
    const sessionId = ctx.params.id;
    const { courseVideoId, watchedSec } = await req.json();
    // progressRate는 클라 값을 받지 않음 (위변조 방지)

    if (!courseVideoId || typeof watchedSec !== 'number' || watchedSec < 0) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '필수 값 누락' },
        { status: 400 }
      );
    }

    const completeRate = await getSettingInt('VIDEO_COMPLETE_RATE');
    const supabase = createServiceClient();

    // 서버가 직접 duration 조회 → progressRate 재계산 (클라 위변조 무력화)
    const { data: video } = await supabase
      .from('course_videos')
      .select('duration_sec')
      .eq('id', courseVideoId)
      .single();

    if (!video) {
      return NextResponse.json(
        { success: false, code: 'VIDEO_NOT_FOUND', message: '영상을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    const dur = video.duration_sec;
    const clampedWatched = Math.min(watchedSec, dur);
    const serverRate = dur > 0 ? Math.round((clampedWatched / dur) * 100) : 0;
    const completed = serverRate >= completeRate;

    const { error } = await supabase
      .from('watch_logs')
      .upsert(
        {
          session_id: sessionId,
          course_video_id: courseVideoId,
          watched_sec: clampedWatched,
          progress_rate: serverRate,
          completed_yn: completed,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'session_id,course_video_id' }
      );

    if (error) {
      console.error(error);
      return NextResponse.json(
        { success: false, code: 'SAVE_FAILED', message: '시청 기록 저장 실패' },
        { status: 500 }
      );
    }

    // 전체 과정 영상 완료 여부 재계산
    const { data: session } = await supabase
      .from('training_sessions')
      .select('course_id')
      .eq('id', sessionId)
      .single();

    if (session) {
      const { data: videos } = await supabase
        .from('course_videos')
        .select('id')
        .eq('course_id', session.course_id);

      const { data: logs } = await supabase
        .from('watch_logs')
        .select('course_video_id, completed_yn')
        .eq('session_id', sessionId);

      const videoIds = (videos ?? []).map((v) => v.id);
      const completedIds = new Set(
        (logs ?? []).filter((l) => l.completed_yn).map((l) => l.course_video_id)
      );
      const allCompleted = videoIds.length > 0 && videoIds.every((id) => completedIds.has(id));

      if (allCompleted) {
        await supabase
          .from('training_sessions')
          .update({ video_completed_yn: true })
          .eq('id', sessionId);
      }
    }

    return NextResponse.json({
      success: true,
      data: { completed },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류' },
      { status: 500 }
    );
  }
}
