/**
 * src/lib/aligo.ts — 알리고 SMS 발송 헬퍼 (R-5)
 *
 * env: ALIGO_USER_ID, ALIGO_API_KEY, ALIGO_SENDER
 * - 90바이트 이내 단문(SMS) 기준. 길면 알리고가 자동 LMS 처리(과금↑)되므로 문안은 짧게.
 * - 발송 실패가 호출측 본 처리를 막으면 안 됨(통지는 best-effort). 이 함수는 throw 하지 않고
 *   { ok, code, message } 로만 반환.
 */

export interface AligoResult {
  ok: boolean;
  code: number | null; // result_code (1 = 성공, 음수 = 오류)
  message: string;
  raw?: unknown;
}

/** 숫자만 남김(전화번호 정규화) */
export function onlyDigits(s: string): string {
  return (s ?? '').replace(/[^0-9]/g, '');
}

export function isAligoConfigured(): boolean {
  return !!(process.env.ALIGO_USER_ID && process.env.ALIGO_API_KEY && process.env.ALIGO_SENDER);
}

/**
 * SMS 1건 발송. 실패해도 throw 하지 않음.
 * @param to   수신번호(하이픈 무관, 내부에서 숫자만 추림)
 * @param text 문안(90바이트 이내 권장)
 */
export async function sendSms(to: string, text: string): Promise<AligoResult> {
  const user_id = process.env.ALIGO_USER_ID;
  const key = process.env.ALIGO_API_KEY;
  const sender = process.env.ALIGO_SENDER;
  if (!user_id || !key || !sender) {
    return { ok: false, code: null, message: 'ALIGO_NOT_CONFIGURED' };
  }

  const receiver = onlyDigits(to);
  if (!receiver) return { ok: false, code: null, message: 'INVALID_RECEIVER' };

  const form = new URLSearchParams();
  form.set('key', key);
  form.set('user_id', user_id);
  form.set('sender', onlyDigits(sender));
  form.set('receiver', receiver);
  form.set('msg', text);

  try {
    const res = await fetch('https://apis.aligo.in/send/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      cache: 'no-store',
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const codeNum = Number(raw?.result_code);
    const ok = codeNum === 1;
    return {
      ok,
      code: Number.isFinite(codeNum) ? codeNum : null,
      message: String(raw?.message ?? ''),
      raw,
    };
  } catch (e) {
    return { ok: false, code: null, message: (e as Error)?.message ?? 'FETCH_FAILED' };
  }
}
