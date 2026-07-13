import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * GET /api/sessions/:id/course
 * 세션에 연결된 교육 과정 + 영상 목록 조회.
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const sessionId = ctx.params.id;
    const supabase = createServiceClient();

    const { data: session } = await supabase
      .from('training_sessions')
      .select('course_id, target_type_id')
      .eq('id', sessionId)
      .single();

    if (!session) {
      return NextResponse.json(
        { success: false, code: 'SESSION_NOT_FOUND', message: '세션을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    const { data: course } = await supabase
      .from('courses')
      .select('id, title, version')
      .eq('id', session.course_id)
      .single();

    const { data: videos } = await supabase
      .from('course_videos')
      .select('id, title, youtube_video_id, duration_sec, sort_order')
      .eq('course_id', session.course_id)
      .order('sort_order', { ascending: true });

    const { data: logs } = await supabase
      .from('watch_logs')
      .select('course_video_id, progress_rate, completed_yn')
      .eq('session_id', sessionId);

    const logMap = new Map((logs ?? []).map((l) => [l.course_video_id, l]));

    const enrichedVideos = (videos ?? []).map((v) => ({
      ...v,
      progressRate: logMap.get(v.id)?.progress_rate ?? 0,
      completedYn: logMap.get(v.id)?.completed_yn ?? false,
    }));

    return NextResponse.json({
      success: true,
      data: {
        course,
        videos: enrichedVideos,
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
