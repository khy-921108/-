/**
 * 사업자번호 국세청 상태조회(서버 전용 — API 키는 app_settings BIZNO_API_KEY, 클라 노출 금지).
 * 체크섬(isValidBizNo) 통과한 번호만 호출할 것(호출 낭비 방지).
 */

import { createServiceClient } from './supabase/server';
import { bizNoDigits, bizStatusLabel } from './bizno';

export type BizStatusResult =
  | { checked: true; status: string; label: string }    // 국세청 응답 있음
  | { checked: false; reason: 'NO_KEY' | 'API_ERROR' }; // 키 없음/호출 실패

/** app_settings 에서 국세청 API 키 조회(BIZNO_API_KEY). 없으면 null */
export async function getBiznoApiKey(): Promise<string | null> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'BIZNO_API_KEY').maybeSingle();
    const v = (data?.value ?? '').trim();
    return v || null;
  } catch {
    return null;
  }
}

/**
 * 국세청 사업자등록 상태조회(공공데이터포털 nts-businessman v1/status).
 * 실패해도 등록·승인 흐름을 막지 않도록 결과 객체만 반환(throw 안 함). 4초 타임아웃.
 */
export async function checkBizStatus(bizNo: string): Promise<BizStatusResult> {
  const key = await getBiznoApiKey();
  if (!key) return { checked: false, reason: 'NO_KEY' };
  const d = bizNoDigits(bizNo);
  try {
    const url = `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ b_no: [d] }),
      signal: AbortSignal.timeout(4000),
      cache: 'no-store',
    });
    if (!res.ok) return { checked: false, reason: 'API_ERROR' };
    const j = await res.json();
    const item = Array.isArray(j?.data) ? j.data[0] : null;
    if (!item) return { checked: false, reason: 'API_ERROR' };
    // 미등록 번호: b_stt_cd 빈값(tax_type 에 "등록되지 않은" 문구)
    const code = (item.b_stt_cd ?? '').trim();
    if (!code) return { checked: true, status: 'NONE', label: bizStatusLabel('NONE') };
    return { checked: true, status: code, label: bizStatusLabel(code) };
  } catch (e) {
    console.error('[bizno-server] status check:', e);
    return { checked: false, reason: 'API_ERROR' };
  }
}
