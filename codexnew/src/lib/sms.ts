/**
 * src/lib/sms.ts — 솔라피(Solapi) SMS 발송 헬퍼 (R-5)
 *
 * 알리고에서 전환한 이유: 알리고 API 는 발송서버 IP 화이트리스트 강제 → Vercel(유동 IP)과 부적합.
 * 솔라피는 API Key + HMAC-SHA256 서명 인증이라 IP 제한 없음.
 *
 * env: SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER
 * - 90바이트 이내 단문(SMS) 기준. 문안은 짧게(장문 LMS 과금 방지).
 * - 발송 실패가 호출측 본 처리를 막으면 안 됨(통지는 best-effort). throw 하지 않고
 *   { ok, code, message } 로만 반환.
 */

import { createHmac, randomBytes } from 'crypto';

export interface SmsResult {
  ok: boolean;
  code: string | null; // solapi statusCode (예: '2000' = 정상 접수)
  message: string;
  raw?: unknown;
}

/** 숫자만 남김(전화번호 정규화) */
export function onlyDigits(s: string): string {
  return (s ?? '').replace(/[^0-9]/g, '');
}

export function isSmsConfigured(): boolean {
  return !!(process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET && process.env.SOLAPI_SENDER);
}

/** 솔라피 HMAC-SHA256 Authorization 헤더 생성 */
function solapiAuthHeader(apiKey: string, apiSecret: string): string {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString('hex');
  const signature = createHmac('sha256', apiSecret).update(date + salt).digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

/**
 * SMS 1건 발송. 실패해도 throw 하지 않음.
 * @param to   수신번호(하이픈 무관)
 * @param text 문안(90바이트 이내 권장)
 */
export async function sendSms(to: string, text: string): Promise<SmsResult> {
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;
  const sender = process.env.SOLAPI_SENDER;
  if (!apiKey || !apiSecret || !sender) {
    return { ok: false, code: null, message: 'SMS_NOT_CONFIGURED' };
  }

  const receiver = onlyDigits(to);
  if (!receiver) return { ok: false, code: null, message: 'INVALID_RECEIVER' };

  try {
    const res = await fetch('https://api.solapi.com/messages/v4/send', {
      method: 'POST',
      headers: {
        Authorization: solapiAuthHeader(apiKey, apiSecret),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          to: receiver,
          from: onlyDigits(sender),
          text,
          type: 'SMS',
        },
      }),
      cache: 'no-store',
    });

    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // 성공: HTTP 200 + statusCode '2000'(정상 접수)
    const statusCode = String(raw?.statusCode ?? '');
    const ok = res.ok && (statusCode === '2000' || statusCode === '');
    return {
      ok: res.ok,
      code: statusCode || (res.ok ? '2000' : String(res.status)),
      message: String(raw?.statusMessage ?? raw?.errorMessage ?? (res.ok ? 'OK' : `HTTP ${res.status}`)),
      raw,
    };
  } catch (e) {
    return { ok: false, code: null, message: (e as Error)?.message ?? 'FETCH_FAILED' };
  }
}
