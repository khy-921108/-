import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * GET /api/home-notice  (공개) — 홈 공지 본문·버전만. 개인정보 없음.
 */
export async function GET() {
  const supabase = createServiceClient();
  const { data } = await supabase.from('app_settings').select('key, value').in('key', ['HOME_NOTICE', 'HOME_NOTICE_AT']);
  const map = new Map((data ?? []).map((r: any) => [r.key, r.value]));
  return NextResponse.json({ notice: map.get('HOME_NOTICE') ?? '', at: map.get('HOME_NOTICE_AT') ?? '' });
}
