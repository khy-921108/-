/**
 * src/app/api/bridge/summary/route.ts — SHE 포털용 브리지(집계 숫자만)
 *
 * [R-1] 서버-서버 통신 전용. x-bridge-key 헤더 == env BRIDGE_KEY 일 때만 응답.
 * - BRIDGE_KEY 미설정 → 503(무방비 개방 금지).
 * - 키 불일치 → 401.
 * - 반환은 **집계 숫자만**(개인정보 없음). 기존 /api/admin/dashboard 집계 패턴 재사용.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store'; // Supabase 조회 캐시 방지(실시간 집계)

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
  const nowISO = now.toISOString();
  const in30ISO = in30days.toISOString();

  const [valid, expiring, permits, pledges, companies] = await Promise.all([
    // 유효 수료(현재 기준 만료 전)
    supabase.from('completions').select('*', { count: 'exact', head: true }).gt('expires_at', nowISO),
    // 30일 내 만료 예정
    supabase.from('completions').select('*', { count: 'exact', head: true }).gt('expires_at', nowISO).lte('expires_at', in30ISO),
    // 진행중 작업허가(작업 종료일이 아직 안 지난 것 = 진행중/예정)
    supabase.from('work_permits').select('*', { count: 'exact', head: true }).gte('work_end', nowISO),
    // 미서명 개인서약(유효기간 내 · signature NULL)
    supabase.from('safety_pledges').select('*', { count: 'exact', head: true }).is('signature', null).gt('expires_at', nowISO),
    // 검토중 업체(status=REVIEW)
    supabase.from('companies').select('*', { count: 'exact', head: true }).eq('status', 'REVIEW'),
  ]);

  return NextResponse.json({
    validCount: valid.count ?? 0,
    expiringSoon: expiring.count ?? 0,
    inProgressPermits: permits.count ?? 0,
    unsignedPledges: pledges.count ?? 0,
    pendingCompanies: companies.count ?? 0,
  });
}
