import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * 교육 과정 + 영상 관리.
 * GET: 모든 과정과 포함된 영상 목록
 * POST { action: 'createCourse' | 'addVideo' | 'updateCourse' | 'removeVideo' | 'toggleActive' }
 */
export async function GET() {
  const auth = await requirePermission('COURSES_MANAGE');
  if (!auth.ok) return auth.response;

  const supabase = createServiceClient();

  const { data: courses } = await supabase
    .from('courses')
    .select('*, target_types(code, label), course_videos(id, title, youtube_video_id, duration_sec, sort_order)')
    .order('id', { ascending: true });

  return NextResponse.json({ success: true, data: { items: courses ?? [] } });
}

export async function POST(req: Request) {
  const auth = await requirePermission('COURSES_MANAGE');
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const supabase = createServiceClient();

  switch (body.action) {
    case 'createCourse': {
      const { data: tt } = await supabase.from('target_types').select('id').eq('code', body.targetType).single();
      if (!tt) return NextResponse.json({ success: false, message: '대상 구분 오류' }, { status: 400 });
      const { data, error } = await supabase
        .from('courses')
        .insert({
          target_type_id: tt.id,
          title: body.title,
          version: body.version ?? 1,
          is_active: true,
        })
        .select()
        .single();
      if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
      return NextResponse.json({ success: true, data });
    }

    case 'updateCourse': {
      const update: Record<string, any> = {};
      if (body.title !== undefined) update.title = body.title;
      if (body.version !== undefined) update.version = body.version;
      if (body.isActive !== undefined) update.is_active = body.isActive;
      const { error } = await supabase.from('courses').update(update).eq('id', body.courseId);
      if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    case 'addVideo': {
      const { data, error } = await supabase
        .from('course_videos')
        .insert({
          course_id: body.courseId,
          title: body.title,
          youtube_video_id: body.youtubeVideoId,
          duration_sec: body.durationSec,
          sort_order: body.sortOrder ?? 0,
        })
        .select()
        .single();
      if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
      return NextResponse.json({ success: true, data });
    }

    case 'removeVideo': {
      const { error } = await supabase.from('course_videos').delete().eq('id', body.videoId);
      if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    default:
      return NextResponse.json({ success: false, message: '지원하지 않는 action' }, { status: 400 });
  }
}
