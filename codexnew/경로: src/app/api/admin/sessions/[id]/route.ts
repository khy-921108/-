import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * DELETE /api/admin/sessions/:id
 * 미완료 세션 삭제 (관리자 전용).
 * - 수료 완료(completions 행 존재) 건은 삭제 거부 (법적 이행 기록 보호)
 * - IN_PROGRESS / FAILED 상태만 삭제 가능
 * - watch_logs, exam_results 는 ON DELETE CASCADE 로 함께 삭제됨
 */
export async function DELETE(
  _req: Request,
  ctx: { params: { id: string } }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const sessionId = ctx.params.id;
  const supabase = createServiceClient();

  // 1. 세션 존재 확인
  const { data: session } = await supabase
    .from('training_sessions')
    .select('id, name, status')
    .eq('id', sessionId)
    .maybeSingle();

  if (!session) {
    return NextResponse.json(
      { success: false, code: 'NOT_FOUND', message: '세션을 찾을 수 없습니다.' },
      { status: 404 }
    );
  }

  // 2. 수료 이력 있는지 확인 (있으면 삭제 거부)
  const { data: completion } = await supabase
    .from('completions')
    .select('id, completion_number')
    .eq('session_id', sessionId)
    .maybeSingle();

  if (completion) {
    return NextResponse.json(
      {
        success: false,
        code: 'COMPLETION_EXISTS',
        message: `수료 이력(${completion.completion_number})이 있는 세션은 삭제할 수 없습니다. 법적 이행 기록은 보존됩니다.`,
      },
      { status: 400 }
    );
  }

  // 3. 삭제 (CASCADE 로 watch_logs/exam_results 동반 삭제)
  const { error } = await supabase
    .from('training_sessions')
    .delete()
    .eq('id', sessionId);

  if (error) {
    console.error(error);
    return NextResponse.json(
      { success: false, code: 'DELETE_FAILED', message: '삭제 실패' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    data: { deletedId: sessionId, name: session.name },
  });
}
