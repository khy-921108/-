import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const supabase = createServiceClient();
  const now = new Date();
  const in30days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    totalSessions,
    completed,
    inProgress,
    failed,
    expiresSoon,
    expired,
  ] = await Promise.all([
    supabase.from('training_sessions').select('*', { count: 'exact', head: true }),
    supabase.from('completions').select('*', { count: 'exact', head: true }).gt('expires_at', now.toISOString()),
    supabase.from('training_sessions').select('*', { count: 'exact', head: true }).eq('status', 'IN_PROGRESS'),
    supabase.from('training_sessions').select('*', { count: 'exact', head: true }).eq('status', 'FAILED'),
    supabase.from('completions').select('*', { count: 'exact', head: true }).gt('expires_at', now.toISOString()).lte('expires_at', in30days.toISOString()),
    supabase.from('completions').select('*', { count: 'exact', head: true }).lte('expires_at', now.toISOString()),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      totalSessions: totalSessions.count ?? 0,
      completedValid: completed.count ?? 0,
      inProgress: inProgress.count ?? 0,
      failed: failed.count ?? 0,
      expiresSoon: expiresSoon.count ?? 0,
      expired: expired.count ?? 0,
    },
  });
}
