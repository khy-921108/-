/**
 * POST /api/verify-phone/confirm — 인증번호 확인 (공개, R-5)
 * req: { phone, code }
 * res: { success } / 실패 시 code=EXPIRED|CODE_MISMATCH|TOO_MANY_ATTEMPTS 등
 *
 * - OTP_TTL_SEC 내 + 시도 5회 이내에만 대조.
 * - 성공 시 verified_at 기록 → /api/sessions 가 이 기록을 요구(서버 강제).
 */

import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { onlyDigits } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const phone = onlyDigits(typeof body.phone === 'string' ? body.phone : '');
    const code = onlyDigits(typeof body.code === 'string' ? body.code : '');
    if (!phone || code.length !== 6) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '인증번호 6자리를 입력해 주세요.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const nowISO = new Date().toISOString();

    // 유효한(미인증·미만료) 최신 코드 조회
    const { data: row } = await supabase
      .from('phone_verifications')
      .select('id, code_hash, salt, attempts, expires_at')
      .eq('phone', phone)
      .is('verified_at', null)
      .gt('expires_at', nowISO)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row) {
      return NextResponse.json(
        { success: false, code: 'EXPIRED', message: '인증번호가 만료되었거나 없습니다. 재전송을 눌러주세요.' },
        { status: 400 }
      );
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { success: false, code: 'TOO_MANY_ATTEMPTS', message: '시도 횟수를 초과했습니다. 재전송을 눌러주세요.' },
        { status: 400 }
      );
    }

    const hash = createHash('sha256').update(row.salt + code).digest('hex');
    if (hash !== row.code_hash) {
      const attempts = row.attempts + 1;
      await supabase.from('phone_verifications').update({ attempts }).eq('id', row.id);
      const left = MAX_ATTEMPTS - attempts;
      return NextResponse.json(
        {
          success: false,
          code: left > 0 ? 'CODE_MISMATCH' : 'TOO_MANY_ATTEMPTS',
          message: left > 0 ? `인증번호가 일치하지 않습니다. (남은 시도 ${left}회)` : '시도 횟수를 초과했습니다. 재전송을 눌러주세요.',
        },
        { status: 400 }
      );
    }

    await supabase
      .from('phone_verifications')
      .update({ verified_at: new Date().toISOString() })
      .eq('id', row.id);

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[verify-phone/confirm] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
