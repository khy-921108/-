import { createHash, randomBytes } from 'crypto';
import type { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizeKrPhone } from '@/lib/phone';

/**
 * "이 휴대폰 기억하기" 서버 공용 함수 (서버 전용).
 * - 열쇠: 32바이트 무작위 값(base64url). 휴대폰에는 HttpOnly 쿠키로만, DB에는 SHA-256 해시만.
 * - 열쇠 원문과 해시는 로그·응답·화면에 남기지 않는다.
 */

export const DEVICE_COOKIE = 'wp_device';
export const DEVICE_DAYS = 90;
export const DEVICE_MAX_PER_PERSON = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

type Db = ReturnType<typeof createServiceClient>;

export interface DeviceRow {
  id: string;
  name: string;
  birth_date: string;
  phone: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
}

export const newDeviceToken = () => randomBytes(32).toString('base64url');
export const hashDeviceToken = (t: string) => createHash('sha256').update(t).digest('hex');

/** 요청의 쿠키 헤더에서 열쇠를 꺼낸다(형식이 맞지 않으면 null). */
export function readDeviceToken(req: Request): string | null {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== DEVICE_COOKIE) continue;
    const v = part.slice(i + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/.test(v) ? v : null;
  }
  return null;
}

export function setDeviceCookie(res: NextResponse, token: string) {
  res.cookies.set(DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_DAYS * 24 * 60 * 60,
  });
}

export function clearDeviceCookie(res: NextResponse) {
  res.cookies.set(DEVICE_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

/** 쿠키에 해당하는 유효한(해제·만료 안 된) 등록. 없으면 null. */
export async function getActiveDevice(supabase: Db, req: Request): Promise<DeviceRow | null> {
  const token = readDeviceToken(req);
  if (!token) return null;
  const { data, error } = await supabase
    .from('device_registrations')
    .select('id, name, birth_date, phone, created_at, last_used_at, expires_at')
    .eq('token_hash', hashDeviceToken(token))
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) {
    console.error('[device] lookup failed:', error.message);
    return null;
  }
  return (data as DeviceRow) ?? null;
}

/** 같은 사람(이름+생년월일+번호)의 유효 등록을 모두 해제한다. 해제 건수를 돌려준다. */
export async function revokePersonDevices(
  supabase: Db,
  person: { name: string; birthDate: string; phone: string },
  reason: string
): Promise<number> {
  const { data, error } = await supabase
    .from('device_registrations')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq('name', person.name.trim())
    .eq('birth_date', person.birthDate)
    .eq('phone', normalizeKrPhone(person.phone))
    .is('revoked_at', null)
    .select('id');
  if (error) throw new Error('DEVICE_REVOKE_FAILED');
  return (data ?? []).length;
}

/** 같은 사람의 유효 등록 수 */
export async function countPersonDevices(
  supabase: Db,
  person: { name: string; birthDate: string; phone: string }
): Promise<number> {
  const { data, error } = await supabase
    .from('device_registrations')
    .select('id')
    .eq('name', person.name.trim())
    .eq('birth_date', person.birthDate)
    .eq('phone', normalizeKrPhone(person.phone))
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString());
  if (error) throw new Error('DEVICE_QUERY_FAILED');
  return (data ?? []).length;
}

/**
 * 문자 인증 면제 판단.
 * - 그 번호의 최근 30분 내 문자 인증 기록이 있거나,
 * - 이 휴대폰이 기억된 휴대폰이고 번호가 같으면(identity 가 주어지면 이름·생년월일까지 같으면) true.
 */
export async function isPhoneProven(
  req: Request,
  phone: string,
  identity?: { name: string; birthDate: string },
  supabase: Db = createServiceClient()
): Promise<boolean> {
  const p = normalizeKrPhone(phone);
  if (p.length < 10) return false;
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: verified, error } = await supabase
    .from('phone_verifications')
    .select('id')
    .eq('phone', p)
    .not('verified_at', 'is', null)
    .gte('verified_at', since)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error('PHONE_CHECK_FAILED');
  if (verified) return true;

  const dev = await getActiveDevice(supabase, req);
  if (!dev || dev.phone !== p) return false;
  if (identity) {
    if (dev.name !== identity.name.trim()) return false;
    if (String(dev.birth_date).slice(0, 10) !== identity.birthDate.trim()) return false;
  }
  return true;
}

export const deviceExpiry = () => new Date(Date.now() + DEVICE_DAYS * DAY_MS).toISOString();
export const DEVICE_PURGE_AFTER_MS = 30 * DAY_MS;

/** 김○○ 형태 */
export function maskName(name: string): string {
  const n = (name ?? '').trim();
  if (!n) return '';
  return n[0] + '○'.repeat(Math.max(n.length - 1, 1));
}
