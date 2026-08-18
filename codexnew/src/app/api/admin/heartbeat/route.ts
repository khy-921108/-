import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import {
  ADMIN_IDLE_TIMEOUT_MS,
  ADMIN_SESSION_EXPIRED_CODE,
  ADMIN_SESSION_EXPIRED_MESSAGE,
} from '@/lib/admin-session';
import { adminIdleRemainingMs, touchAdminActivity } from '@/lib/admin-session-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * POST /api/admin/heartbeat  (requireAdmin)
 *
 * 🔴 세션을 연장하는 **유일한** 경로.
 *    관리자 화면에서 클릭·키입력·스크롤·화면이동 등 사용자의 실제 조작이 있었을 때만 전송된다.
 *    화면의 자동 새로고침·백그라운드 폴링·단순 조회 API 는 이 경로를 타지 않으므로
 *    세션을 연장하지 못한다(자리를 비우면 그대로 만료).
 */
/**
 * GET /api/admin/heartbeat  (requireAdmin) — **연장하지 않는 확인 전용**
 *
 * 🔴 클라이언트는 자기 탭의 타이머만 보고 로그아웃하면 안 된다(다른 탭이 작업 중일 수 있음).
 *    로컬에서 만료로 보이면 먼저 이 경로로 서버에 물어보고, 서버가 만료(401)라고 할 때만
 *    signOut 한다. 아직 유효하면 남은 시간(remainingMs)으로 로컬 타이머를 맞춘다.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response; // 만료면 401 SESSION_EXPIRED

  const remainingMs = await adminIdleRemainingMs(createServiceClient(), auth.admin.email, auth.user.lastSignInAt);
  return NextResponse.json({ success: true, data: { valid: true, remainingMs, idleTimeoutMs: ADMIN_IDLE_TIMEOUT_MS } });
}

export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const svc = createServiceClient();
  const { expired } = await touchAdminActivity(svc, auth.admin.email, auth.user.lastSignInAt);
  if (expired) {
    return NextResponse.json(
      { success: false, code: ADMIN_SESSION_EXPIRED_CODE, message: ADMIN_SESSION_EXPIRED_MESSAGE },
      { status: 401 }
    );
  }
  return NextResponse.json({ success: true, data: { idleTimeoutMs: ADMIN_IDLE_TIMEOUT_MS } });
}
