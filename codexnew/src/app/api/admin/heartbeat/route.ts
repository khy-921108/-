import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { ADMIN_IDLE_TIMEOUT_MS } from '@/lib/admin-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * POST /api/admin/heartbeat  (requireAdmin)
 * 관리자 화면에서 실제 활동(클릭·입력·화면 이동)이 있었을 때만 호출한다.
 * requireAdmin 안에서 마지막 활동 시각이 갱신되고, 무활동 기준을 넘겼으면 401(SESSION_EXPIRED).
 * → 자동 로그아웃 판정의 최종 권한은 항상 서버에 있다.
 */
export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ success: true, data: { idleTimeoutMs: ADMIN_IDLE_TIMEOUT_MS } });
}
