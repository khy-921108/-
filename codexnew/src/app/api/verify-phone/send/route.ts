/**
 * POST /api/verify-phone/send — 인증번호 발송 (공개, R-5)
 * req: { phone }
 * res: { success, data:{ ttlSec, resendSec } }
 *
 * 남용 방지(문자 = 건당 과금):
 * - 동일 번호 재전송은 OTP_RESEND_SEC 경과 후에만 (429 + retryAfterSec)
 * - 동일 번호 하루 5회 제한 (429)
 * - 재전송 시 이전 미인증 코드 즉시 무효화
 * - 코드 평문 저장 금지: sha256(salt + code)
 */

import { NextResponse } from 'next/server';
import { createHash, randomBytes, randomInt } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { getSettingInt } from '@/lib/settings';
import { sendSms, isSmsConfigured, onlyDigits } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const DAILY_LIMIT = 5;

export async function POST(req: Request) {
  try {
    if (!isSmsConfigured()) {
      return NextResponse.json(
        { success: false, code: 'SMS_DISABLED', message: '문자 발송이 설정되지 않았습니다. 관리자에게 문의하세요.' },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const phone = onlyDigits(typeof body.phone === 'string' ? body.phone : '');
    if (phone.length < 10 || phone.length > 11 || !phone.startsWith('01')) {
      return NextResponse.json(
        { success: false, code: 'INVALID_PHONE', message: '휴대폰 번호를 정확히 입력해 주세요.' },
        { status: 400 }
      );
    }

    const [ttlSec, resendSec] = await Promise.all([
      getSettingInt('OTP_TTL_SEC'),
      getSettingInt('OTP_RESEND_SEC'),
    ]);

    const supabase = createServiceClient();
    const now = new Date();

    // 1) 하루 5회 제한
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { count: dayCount } = await supabase
      .from('phone_verifications')
      .select('*', { count: 'exact', head: true })
      .eq('phone', phone)
      .gte('created_at', dayAgo);
    if ((dayCount ?? 0) >= DAILY_LIMIT) {
      return NextResponse.json(
        { success: false, code: 'DAILY_LIMIT', message: '인증번호 발송 한도(하루 5회)를 초과했습니다. 내일 다시 시도해 주세요.' },
        { status: 429 }
      );
    }

    // 2) 재전송 간격 제한
    const { data: lastRow } = await supabase
      .from('phone_verifications')
      .select('created_at')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastRow) {
      const elapsed = (now.getTime() - new Date(lastRow.created_at).getTime()) / 1000;
      if (elapsed < resendSec) {
        const wait = Math.ceil(resendSec - elapsed);
        return NextResponse.json(
          { success: false, code: 'RESEND_TOO_SOON', message: `재전송은 ${wait}초 후 가능합니다.`, retryAfterSec: wait },
          { status: 429 }
        );
      }
    }

    // 3) 이전 미인증 코드 즉시 무효화
    await supabase
      .from('phone_verifications')
      .update({ expires_at: now.toISOString() })
      .eq('phone', phone)
      .is('verified_at', null)
      .gt('expires_at', now.toISOString());

    // 4) 새 코드 생성 → 해시 저장
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const salt = randomBytes(16).toString('hex');
    const codeHash = createHash('sha256').update(salt + code).digest('hex');
    const expiresAt = new Date(now.getTime() + ttlSec * 1000).toISOString();

    const { data: inserted, error: insErr } = await supabase
      .from('phone_verifications')
      .insert({ phone, code_hash: codeHash, salt, expires_at: expiresAt })
      .select('id')
      .single();
    if (insErr || !inserted) {
      console.error('[verify-phone/send] insert failed:', insErr);
      return NextResponse.json(
        { success: false, code: 'SAVE_FAILED', message: '인증번호 저장에 실패했습니다.' },
        { status: 500 }
      );
    }

    // 5) 문자 발송 (실패 시 방금 행 무효화 → 재전송 타이머에 안 걸리게)
    const sms = await sendSms(phone, `[동남] 인증번호 [${code}] 를 입력해 주세요. (${Math.floor(ttlSec / 60)}분 내 유효)`);
    if (!sms.ok) {
      console.error('[verify-phone/send] sms failed:', sms.code, sms.message);
      await supabase
        .from('phone_verifications')
        .update({ expires_at: now.toISOString(), created_at: new Date(now.getTime() - resendSec * 1000).toISOString() })
        .eq('id', inserted.id);
      return NextResponse.json(
        { success: false, code: 'SMS_FAILED', message: '문자 발송에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, data: { ttlSec, resendSec } });
  } catch (e) {
    console.error('[verify-phone/send] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
