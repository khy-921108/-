import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { maskPhone } from '@/lib/format';
import { clearDeviceCookie, getActiveDevice, maskName, readDeviceToken } from '@/lib/device';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const NO_STORE = { 'Cache-Control': 'no-store' };
const HOUR_MS = 60 * 60 * 1000;

/**
 * GET /api/device/me  (공개) — 이 휴대폰에 기억된 본인 정보
 * - 유효 쿠키면 그 주인의 이름·생년월일·번호와 마스킹 값을 돌려준다(이 휴대폰 주인 본인 정보만).
 * - 같은 정보의 교육 기록이 없어졌으면 IDENTITY_GONE 으로 해제하고 미등록으로 응답.
 * - last_used_at 은 1시간에 1번만 갱신.
 */
export async function GET(req: Request) {
  const notRegistered = (clear: boolean) => {
    const res = NextResponse.json({ success: true, data: { registered: false } }, { headers: NO_STORE });
    if (clear) clearDeviceCookie(res);
    return res;
  };

  try {
    const hadCookie = !!readDeviceToken(req);
    if (!hadCookie) return notRegistered(false);

    const supabase = createServiceClient();
    const dev = await getActiveDevice(supabase, req);
    if (!dev) return notRegistered(true);

    const birthDate = String(dev.birth_date).slice(0, 10);
    const { data: sess, error } = await supabase
      .from('training_sessions')
      .select('id')
      .eq('name', dev.name)
      .eq('birth_date', birthDate)
      .eq('phone', dev.phone)
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    const nowIso = new Date().toISOString();
    if (!sess) {
      await supabase
        .from('device_registrations')
        .update({ revoked_at: nowIso, revoked_reason: 'IDENTITY_GONE' })
        .eq('id', dev.id);
      return notRegistered(true);
    }

    if (!dev.last_used_at || Date.now() - new Date(dev.last_used_at).getTime() >= HOUR_MS) {
      await supabase.from('device_registrations').update({ last_used_at: nowIso }).eq('id', dev.id);
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          registered: true,
          name: dev.name,
          birthDate,
          phone: dev.phone,
          nameMasked: maskName(dev.name),
          phoneMasked: maskPhone(dev.phone),
          expiresAt: dev.expires_at,
        },
      },
      { headers: NO_STORE }
    );
  } catch (e: any) {
    console.error('[device/me] failed:', e?.message ?? 'unknown');
    // 확인이 안 되면 기억 없음으로 취급(화면은 직접 입력으로 진행)
    return NextResponse.json({ success: true, data: { registered: false } }, { headers: NO_STORE });
  }
}
