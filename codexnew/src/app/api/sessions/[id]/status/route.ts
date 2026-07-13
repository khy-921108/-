import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * GET /api/sessions/:id/status
 * 세션의 수료/만료 상태 조회.
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  try {
    const sessionId = ctx.params.id;
    const supabase = createServiceClient();

    const { data: session } = await supabase
      .from('training_sessions')
      .select('id, status, video_completed_yn, name, affiliation')
      .eq('id', sessionId)
      .single();

    if (!session) {
      return NextResponse.json(
        { success: false, code: 'SESSION_NOT_FOUND', message: '세션을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    const { data: completion } = await supabase
      .from('completions')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (!completion) {
      return NextResponse.json({
        success: true,
        data: {
          status: session.status,
          videoCompleted: session.video_completed_yn,
          completion: null,
        },
      });
    }

    const expired = new Date(completion.expires_at) <= new Date();

    return NextResponse.json({
      success: true,
      data: {
        status: expired ? 'EXPIRED' : session.status,
        videoCompleted: session.video_completed_yn,
        completion: {
          completionNumber: completion.completion_number,
          completedAt: completion.completed_at,
          validUntil: completion.expires_at,
          score: completion.score,
          expired,
        },
        trainee: {
          name: session.name,
          affiliation: session.affiliation,
        },
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
