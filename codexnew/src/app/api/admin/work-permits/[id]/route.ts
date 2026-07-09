import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import {
  SUPPLEMENTAL_CONFIRM_DEPT,
  isSupplementalKey,
  supplementalLabel,
  type SupplementalKey,
} from '@/lib/work-permit-constants';

export const runtime = 'nodejs';
export const fetchCache = 'force-no-store';
export const maxDuration = 30; // 무한 대기 방지(초과 시 함수 종료)

const DB_TIMEOUT_MS = 12000;
/** DB 호출이 매달리면 무한 pending 대신 에러로 반환 — 저장 요청은 반드시 응답한다. */
function withTimeout<T>(p: PromiseLike<T>, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`DB_TIMEOUT:${label}`)), DB_TIMEOUT_MS)),
  ]);
}

/**
 * PATCH /api/admin/work-permits/:id  — R-6 게이트③ 승인/서명/확인/종료
 * 처리자(actor)=로그인 관리자 이메일(서버가 채움). 단계별 개별 액션(일괄 금지).
 *
 * action:
 *  ③-2a) 'issue'   1차 발급(안전환경)  · 'witness' 2차 입회(안전환경, 1차 후)
 *  ③-2b) 'dept_confirm'   3차 별지 현장확인(담당부서 개별 서명)
 *        'dept_proxy'     공무 별지 SUPER 긴급대리(사유 필수, EMERGENCY_PROXY)
 *        'complete_report' 종료신고(작업자/소장; 안전환경 대리입력)
 *        'complete_confirm' 종료확인(안전환경 최종) → status COMPLETED
 *        'start_work'      작업개시 최종승인(공무 미확인 화기·전기 별지 있으면 차단) → status APPROVED
 *
 * 권한: 안전환경 계열=WORKPERMITS_APPROVE(SUPER 통과). 공무 별지 정상확인=WORKPERMITS_DEPT_CONFIRM(명시부여).
 *       긴급대리=SUPER 전용.
 */
export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  try {
  const auth = await withTimeout(requireAdmin(), 'auth');
  if (!auth.ok) return auth.response;
  const actor = auth.admin.email;
  const isSuper = auth.admin.role === 'SUPER';
  const perms = auth.admin.permissions ?? [];
  const hasApprove = isSuper || perms.includes('WORKPERMITS_APPROVE');
  const hasDeptConfirm = perms.includes('WORKPERMITS_DEPT_CONFIRM'); // 명시 부여만(SUPER all-pass 제외)

  let body: any;
  try {
    body = await withTimeout(req.json(), 'body');
  } catch {
    return NextResponse.json({ success: false, code: 'BAD_REQUEST', message: '잘못된 요청입니다.' }, { status: 400 });
  }
  const action = body?.action;
  const signature = typeof body?.signature === 'string' ? body.signature : '';
  const needSig = action !== 'start_work';
  if (needSig && !signature.startsWith('data:image/')) {
    return NextResponse.json({ success: false, code: 'NO_SIGNATURE', message: '서명이 필요합니다.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  // 저장 후 실제 반영 검증: .select() 로 갱신된 행을 돌려받아 0행이면 실패 처리(조용한 미저장 방지).
  const patchPermit = async (fields: Record<string, any>): Promise<{ error: any }> => {
    const { data, error } = (await withTimeout(
      supabase.from('work_permits').update(fields).eq('id', ctx.params.id).select('id'),
      'update'
    )) as { data: any[] | null; error: any };
    if (error) return { error };
    if (!data || data.length === 0) return { error: { message: 'NO_ROW_UPDATED' } };
    return { error: null };
  };

  const { data: permit, error: readErr } = await withTimeout(
    supabase
      .from('work_permits')
      .select('id, status, supplemental, issuer_signature, tbm, dept_confirmations, completion')
      .eq('id', ctx.params.id)
      .maybeSingle(),
    'select'
  );

  if (readErr) {
    console.error('[admin/work-permits PATCH] read:', readErr);
    return NextResponse.json({ success: false, code: 'QUERY_FAILED', message: '조회 오류' }, { status: 500 });
  }
  if (!permit) {
    return NextResponse.json({ success: false, code: 'NOT_FOUND', message: '허가서를 찾을 수 없습니다.' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const forbidden = () =>
    NextResponse.json({ success: false, code: 'FORBIDDEN', message: '이 작업에 대한 권한이 없습니다.' }, { status: 403 });
  const fail = (code: string, message: string, status = 400) =>
    NextResponse.json({ success: false, code, message }, { status });

  // ===== ③-2a =====
  if (action === 'issue') {
    if (!hasApprove) return forbidden();
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : null;
    const { error } = await patchPermit({ issuer_signature: signature, issuer_title: title, approved_by: actor, approved_at: now });
    if (error) return fail('UPDATE_FAILED', '저장 실패', 500);
    return NextResponse.json({ success: true, data: { action, by: actor, at: now } });
  }

  if (action === 'witness') {
    if (!hasApprove) return forbidden();
    if (!permit.issuer_signature) return fail('ORDER_VIOLATION', '1차 승인(발급)을 먼저 완료해야 합니다.', 409);
    const instructions = typeof body?.safetyInstructions === 'string' ? body.safetyInstructions.trim() : '';
    if (!instructions) return fail('NO_INSTRUCTIONS', '오늘의 안전지시사항을 입력해 주세요.');
    const tbm = (permit.tbm ?? {}) as Record<string, any>;
    tbm.safetyInstructions = instructions;
    tbm.witness = { signature, at: now, by: actor };
    const { error } = await patchPermit({ tbm });
    if (error) return fail('UPDATE_FAILED', '저장 실패', 500);
    return NextResponse.json({ success: true, data: { action, by: actor, at: now } });
  }

  // ===== ③-2b : 3차 별지 현장확인 =====
  if (action === 'dept_confirm' || action === 'dept_proxy') {
    const supKey = body?.supKey;
    if (!isSupplementalKey(supKey)) return fail('BAD_SUPKEY', '별지 종류가 올바르지 않습니다.');
    const supp = (permit.supplemental ?? {}) as Record<string, string>;
    if (supp[supKey] !== 'Y') return fail('SUP_NOT_ATTACHED', '해당 별지가 이 허가서에 포함되어 있지 않습니다.');
    const dept = SUPPLEMENTAL_CONFIRM_DEPT[supKey as SupplementalKey];
    const confs = (permit.dept_confirmations ?? {}) as Record<string, any>;

    if (action === 'dept_proxy') {
      // 공무 별지 한정, SUPER 전용, 사유 필수
      if (dept !== '공무') return fail('PROXY_NOT_ALLOWED', '긴급 대리확인은 공무 담당 별지(화기·정전)만 가능합니다.');
      if (!isSuper) return forbidden();
      const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
      if (!reason) return fail('NO_REASON', '긴급 대리확인 사유를 입력해 주세요.');
      confs[supKey] = { dept: '공무', by: actor, name: null, signature, at: now, mode: 'EMERGENCY_PROXY', reason };
    } else {
      // 정상 확인: 안전환경 별지=WORKPERMITS_APPROVE / 공무 별지=WORKPERMITS_DEPT_CONFIRM(명시)
      const allowed = dept === '안전환경' ? hasApprove : hasDeptConfirm;
      if (!allowed) return forbidden();
      const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : null;
      confs[supKey] = { dept, by: actor, name, signature, at: now, mode: 'NORMAL', reason: null };
    }
    const { error } = await patchPermit({ dept_confirmations: confs });
    if (error) return fail('UPDATE_FAILED', '저장 실패', 500);
    return NextResponse.json({ success: true, data: { action, supKey, dept, by: actor, at: now } });
  }

  // ===== ③-2b : 종료 2단계 =====
  if (action === 'complete_report') {
    if (!hasApprove) return forbidden();
    const comp = (permit.completion ?? {}) as Record<string, any>;
    const completedAt = typeof body?.completedAt === 'string' && body.completedAt ? body.completedAt : now;
    comp.completedAt = completedAt;
    comp.workerSignature = signature;
    comp.restoreState = typeof body?.restoreState === 'string' ? body.restoreState.trim() : (comp.restoreState ?? '');
    comp.reportBy = actor;
    comp.reportAt = now;
    const { error } = await patchPermit({ completion: comp });
    if (error) return fail('UPDATE_FAILED', '저장 실패', 500);
    return NextResponse.json({ success: true, data: { action, by: actor, at: now } });
  }

  if (action === 'complete_confirm') {
    if (!hasApprove) return forbidden();
    const comp = (permit.completion ?? {}) as Record<string, any>;
    if (!comp.workerSignature) return fail('ORDER_VIOLATION', '종료신고를 먼저 완료해야 합니다.', 409);
    comp.confirmSignature = signature;
    comp.confirmBy = actor;
    comp.confirmAt = now;
    const { error } = await patchPermit({ completion: comp, status: 'COMPLETED' });
    if (error) return fail('UPDATE_FAILED', '저장 실패', 500);
    return NextResponse.json({ success: true, data: { action, by: actor, at: now, status: 'COMPLETED' } });
  }

  // ===== ③-2b : 작업개시 최종승인(게이트) =====
  if (action === 'start_work') {
    if (!hasApprove) return forbidden();
    const tbm = (permit.tbm ?? {}) as Record<string, any>;
    const confs = (permit.dept_confirmations ?? {}) as Record<string, any>;
    const supp = (permit.supplemental ?? {}) as Record<string, string>;
    const missing: string[] = [];
    if (!permit.issuer_signature) missing.push('1차 발급 서명');
    if (!tbm.witness?.signature) missing.push('2차 입회 서명');
    for (const key of Object.keys(SUPPLEMENTAL_CONFIRM_DEPT) as SupplementalKey[]) {
      if (supp[key] !== 'Y') continue;
      if (!confs[key]?.signature) {
        const dept = SUPPLEMENTAL_CONFIRM_DEPT[key];
        missing.push(`${supplementalLabel(key)} 별지 ${dept} 현장확인`);
      }
    }
    if (missing.length > 0) {
      return fail('GATE_BLOCKED', `작업개시 차단 — 미완료: ${missing.join(', ')}`, 409);
    }
    const { error } = await patchPermit({ status: 'APPROVED', started_by: actor, started_at: now });
    if (error) return fail('UPDATE_FAILED', '저장 실패', 500);
    return NextResponse.json({ success: true, data: { action, by: actor, at: now, status: 'APPROVED' } });
  }

  return fail('BAD_ACTION', '알 수 없는 동작입니다.');
  } catch (e) {
    const msg = (e as Error)?.message ?? '';
    console.error('[admin/work-permits PATCH] fatal:', msg);
    const timeout = msg.startsWith('DB_TIMEOUT');
    return NextResponse.json(
      {
        success: false,
        code: timeout ? 'DB_TIMEOUT' : 'SERVER_ERROR',
        message: timeout ? '저장이 지연되어 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' : '서버 오류가 발생했습니다.',
      },
      { status: timeout ? 504 : 500 }
    );
  }
}
