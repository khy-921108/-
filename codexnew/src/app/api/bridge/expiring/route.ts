/**
 * src/app/api/bridge/expiring/route.ts — SHE 포털용 브리지(만료 임박 명단)
 *
 * [R-1] 서버-서버 전용. x-bridge-key == env BRIDGE_KEY 일 때만 응답.
 * - BRIDGE_KEY 미설정 → 503 / 키 불일치 → 401.
 * - 30일 내 만료 예정자: [{ name, company, expiresAt }] **딱 3필드만**(전화번호 등 금지).
 * - PostgREST 중첩 JOIN 대신 별도 쿼리 후 JS Map(안전).
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store'; // Supabase 조회 캐시 방지(실시간 명단)

export async function GET(req: Request) {
  const key = process.env.BRIDGE_KEY;
  if (!key) {
    return NextResponse.json({ error: 'BRIDGE_DISABLED' }, { status: 503 });
  }
  if (req.headers.get('x-bridge-key') !== key) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const in30days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // 1) 30일 내 만료 수료 (만료일 오름차순)
  const { data: comps } = await supabase
    .from('completions')
    .select('session_id, expires_at')
    .gt('expires_at', now.toISOString())
    .lte('expires_at', in30days.toISOString())
    .order('expires_at', { ascending: true });

  const rows = comps ?? [];
  const sessionIds = rows.map((c) => c.session_id).filter(Boolean);

  // 2) 해당 세션의 이름·소속만 별도 조회 (전화번호 미조회)
  const sessionMap: Record<string, { name: string; affiliation: string }> = {};
  if (sessionIds.length > 0) {
    const { data: sessions } = await supabase
      .from('training_sessions')
      .select('id, name, affiliation')
      .in('id', sessionIds);
    for (const s of sessions ?? []) {
      sessionMap[s.id] = { name: s.name, affiliation: s.affiliation };
    }
  }

  const items = rows.map((c) => {
    const s = sessionMap[c.session_id] ?? { name: '', affiliation: '' };
    return { name: s.name ?? '', company: s.affiliation ?? '', expiresAt: c.expires_at };
  });

  return NextResponse.json({ items });
}
