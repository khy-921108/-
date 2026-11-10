import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { clearDeviceCookie, hashDeviceToken, readDeviceToken } from '@/lib/device';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * POST /api/device/revoke  (공개) — 이 휴대폰의 기억 해제 + 쿠키 삭제
 */
export async function POST(req: Request) {
  const token = readDeviceToken(req);
  try {
    if (token) {
      const supabase = createServiceClient();
      await supabase
        .from('device_registrations')
        .update({ revoked_at: new Date().toISOString(), revoked_reason: 'USER' })
        .eq('token_hash', hashDeviceToken(token))
        .is('revoked_at', null);
    }
  } catch (e: any) {
    console.error('[device/revoke] failed:', e?.message ?? 'unknown');
  }
  const res = NextResponse.json({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
  clearDeviceCookie(res);
  return res;
}
