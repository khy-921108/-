import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { clearAdminActivity } from '@/lib/admin-session-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * POST /api/admin/logout
 * 관리자가 직접 로그아웃할 때 서버에 남은 활동 기록을 지운다.
 * (Supabase signOut 은 클라이언트에서 별도로 수행 — 여기서는 활동 기록 정리만)
 * 이미 만료된 세션이면 지울 것도 없으므로 조용히 성공 처리한다.
 */
export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ success: true, data: { cleared: false } });

  await clearAdminActivity(createServiceClient(), auth.admin.email);
  return NextResponse.json({ success: true, data: { cleared: true } });
}
