import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';

export const fetchCache = 'force-no-store';

/**
 * PATCH /api/admin/work-permits/:id  — R-6 게이트③-2a 승인 서명 저장
 * 권한: WORKPERMITS_APPROVE (SUPER 통과). 처리자(actor)=로그인 관리자 이메일(서버가 채움).
 *
 * body.action:
 *  - 'issue'   : 1차 승인(발급자·안전환경) → issuer_signature/issuer_title/approved_by/approved_at
 *  - 'witness' : 2차 승인(입회자·안전환경) → tbm.witness + tbm.safetyInstructions
 *                (1차 완료 후에만 허용 — 순서 강제)
 *
 * ⚠️ 3차 별지 현장확인·공무 부서확인은 ③-2b(미구현). 여기서 status 는 변경하지 않음.
 */
export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission('WORKPERMITS_APPROVE');
  if (!auth.ok) return auth.response;
  const actor = auth.admin.email;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, code: 'BAD_REQUEST', message: '잘못된 요청입니다.' }, { status: 400 });
  }

  const action = body?.action;
  const signature = typeof body?.signature === 'string' ? body.signature : '';
  if (!signature.startsWith('data:image/')) {
    return NextResponse.json({ success: false, code: 'NO_SIGNATURE', message: '서명이 필요합니다.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: permit, error: readErr } = await supabase
    .from('work_permits')
    .select('id, issuer_signature, tbm')
    .eq('id', ctx.params.id)
    .maybeSingle();

  if (readErr) {
    console.error('[admin/work-permits PATCH] read:', readErr);
    return NextResponse.json({ success: false, code: 'QUERY_FAILED', message: '조회 오류' }, { status: 500 });
  }
  if (!permit) {
    return NextResponse.json({ success: false, code: 'NOT_FOUND', message: '허가서를 찾을 수 없습니다.' }, { status: 404 });
  }

  const now = new Date().toISOString();

  if (action === 'issue') {
    // 1차 발급(안전환경). 재서명 시 덮어쓰기(클라에서 확인).
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : null;
    const { error } = await supabase
      .from('work_permits')
      .update({
        issuer_signature: signature,
        issuer_title: title,
        approved_by: actor,
        approved_at: now,
      })
      .eq('id', ctx.params.id);
    if (error) {
      console.error('[admin/work-permits PATCH] issue:', error);
      return NextResponse.json({ success: false, code: 'UPDATE_FAILED', message: '저장 실패' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data: { action, by: actor, at: now } });
  }

  if (action === 'witness') {
    // 순서 강제: 1차 발급 없이는 2차 입회 불가
    if (!permit.issuer_signature) {
      return NextResponse.json(
        { success: false, code: 'ORDER_VIOLATION', message: '1차 승인(발급)을 먼저 완료해야 합니다.' },
        { status: 409 }
      );
    }
    const instructions = typeof body?.safetyInstructions === 'string' ? body.safetyInstructions.trim() : '';
    if (!instructions) {
      return NextResponse.json(
        { success: false, code: 'NO_INSTRUCTIONS', message: '오늘의 안전지시사항을 입력해 주세요.' },
        { status: 400 }
      );
    }
    const tbm = (permit.tbm ?? {}) as Record<string, any>;
    tbm.safetyInstructions = instructions;
    tbm.witness = { signature, at: now, by: actor };

    const { error } = await supabase.from('work_permits').update({ tbm }).eq('id', ctx.params.id);
    if (error) {
      console.error('[admin/work-permits PATCH] witness:', error);
      return NextResponse.json({ success: false, code: 'UPDATE_FAILED', message: '저장 실패' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data: { action, by: actor, at: now } });
  }

  return NextResponse.json({ success: false, code: 'BAD_ACTION', message: '알 수 없는 동작입니다.' }, { status: 400 });
}
