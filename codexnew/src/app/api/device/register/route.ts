import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizeKrPhone } from '@/lib/phone';
import { maskPhone } from '@/lib/format';
import {
  DEVICE_MAX_PER_PERSON,
  DEVICE_PURGE_AFTER_MS,
  deviceExpiry,
  getActiveDevice,
  hashDeviceToken,
  maskName,
  newDeviceToken,
  setDeviceCookie,
} from '@/lib/device';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const fail = (code: string, message: string, status = 400) =>
  NextResponse.json({ success: false, code, message }, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * POST /api/device/register  (공개) — 이 휴대폰 기억하기(90일)
 * req: { name, birthDate, phone }
 * - 그 번호의 최근 10분 내 문자 인증 + 같은 이름·생년월일·번호의 교육 기록이 있어야 한다.
 * - 한 사람당 유효 3대. 넘으면 가장 오래된 것을 LIMIT 으로 해제.
 * - 이 브라우저에 이미 다른 기억이 있으면 REPLACED 로 해제(한 브라우저 = 한 사람).
 * - 응답은 마스킹된 이름·번호만. 열쇠는 HttpOnly 쿠키로만 보낸다.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = (typeof body.name === 'string' ? body.name : '').trim();
    const birthDate = (typeof body.birthDate === 'string' ? body.birthDate : '').trim();
    const phone = normalizeKrPhone(typeof body.phone === 'string' ? body.phone : '');
    if (!name || name.length > 50 || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || phone.length < 10) {
      return fail('INVALID_INPUT', '이름·생년월일·연락처를 확인해 주세요.');
    }

    const supabase = createServiceClient();
    const now = Date.now();

    const { data: verified, error: vErr } = await supabase
      .from('phone_verifications')
      .select('id')
      .eq('phone', phone)
      .not('verified_at', 'is', null)
      .gte('verified_at', new Date(now - 10 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle();
    if (vErr) throw vErr;
    if (!verified) return fail('PHONE_NOT_VERIFIED', '휴대폰 문자 인증을 먼저 완료해 주세요.', 403);

    const { data: sess, error: sErr } = await supabase
      .from('training_sessions')
      .select('id')
      .eq('name', name)
      .eq('birth_date', birthDate)
      .eq('phone', phone)
      .limit(1)
      .maybeSingle();
    if (sErr) throw sErr;
    if (!sess) return fail('NO_EDU', '안전교육을 받은 기록이 없어 기억할 수 없습니다.', 403);

    // 오래된 행 정리: 만료 또는 해제 후 30일 지난 것
    const purgeBefore = new Date(now - DEVICE_PURGE_AFTER_MS).toISOString();
    await supabase.from('device_registrations').delete().lt('expires_at', purgeBefore);
    await supabase.from('device_registrations').delete().lt('revoked_at', purgeBefore);

    const nowIso = new Date(now).toISOString();

    // 이 브라우저의 기존 기억은 바꿔 끼운다
    const prev = await getActiveDevice(supabase, req);
    if (prev) {
      await supabase
        .from('device_registrations')
        .update({ revoked_at: nowIso, revoked_reason: 'REPLACED' })
        .eq('id', prev.id);
    }

    // 한 사람당 유효 3대 — 새로 넣을 1대 자리를 비운다
    const { data: active, error: aErr } = await supabase
      .from('device_registrations')
      .select('id, created_at')
      .eq('name', name)
      .eq('birth_date', birthDate)
      .eq('phone', phone)
      .is('revoked_at', null)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: true });
    if (aErr) throw aErr;
    const over = (active ?? []).length - (DEVICE_MAX_PER_PERSON - 1);
    for (const row of (active ?? []).slice(0, Math.max(0, over))) {
      await supabase
        .from('device_registrations')
        .update({ revoked_at: nowIso, revoked_reason: 'LIMIT' })
        .eq('id', row.id);
    }

    const token = newDeviceToken();
    const expiresAt = deviceExpiry();
    const { error: iErr } = await supabase.from('device_registrations').insert({
      token_hash: hashDeviceToken(token),
      name,
      birth_date: birthDate,
      phone,
      user_agent: (req.headers.get('user-agent') ?? '').slice(0, 200) || null,
      created_at: nowIso,
      last_used_at: nowIso,
      expires_at: expiresAt,
    });
    if (iErr) throw iErr;

    const res = NextResponse.json(
      { success: true, data: { nameMasked: maskName(name), phoneMasked: maskPhone(phone), expiresAt } },
      { headers: { 'Cache-Control': 'no-store' } }
    );
    setDeviceCookie(res, token);
    return res;
  } catch (e: any) {
    console.error('[device/register] failed:', e?.message ?? 'unknown');
    return fail('SERVER_ERROR', '기억하지 못했습니다. 잠시 후 다시 시도해 주세요.', 500);
  }
}
