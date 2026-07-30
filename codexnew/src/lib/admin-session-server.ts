/**
 * 관리자 세션 자동 로그아웃 — 서버 판정 (bizno.ts / bizno-server.ts 와 같은 분리 방식)
 *
 * 🔴 마지막 활동 시각은 **서버(app_settings)** 에만 둔다.
 *    쿠키·localStorage 에 두면 개발자도구로 값을 고쳐 만료를 우회할 수 있다.
 *    app_settings 는 RLS 로 service_role 만 접근하므로 브라우저에서 조작 불가.
 *
 * 스키마 변경 없음 — 기존 app_settings(key VARCHAR(50), value VARCHAR(200)) 에
 * 관리자 1명당 행 1개(`ADMIN_SEEN_<이메일해시>`)를 쓴다.
 */

import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ADMIN_IDLE_TIMEOUT_MS } from './admin-session';

/** 쓰기 부담을 줄이기 위해 이 간격 안의 재요청은 갱신을 건너뛴다(무활동 판정 해상도 60초) */
const TOUCH_THROTTLE_MS = 60 * 1000;

/** key VARCHAR(50) 제한 — 이메일 대신 sha256 앞 16자리를 쓴다(총 27자) */
function seenKey(email: string): string {
  const h = createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);
  return `ADMIN_SEEN_${h}`;
}

/**
 * 마지막 활동 시각을 확인하고 갱신한다.
 *
 * 판정 기준 = max(저장된 활동시각, 마지막 로그인 시각).
 *  · 방금 로그인했으면 저장된 값이 오래됐어도 통과한다(전날 기록 때문에 바로 튕기는 것 방지).
 *  · lastSignInAt 은 **비밀번호 로그인에서만** 갱신되고 토큰 자동 갱신으로는 바뀌지 않으므로,
 *    남의 폰에 남아 있는 세션으로는 창을 새로 얻을 수 없다.
 *
 * @param lastSignInAt Supabase user.last_sign_in_at (ISO)
 * @returns expired=true 면 무활동 기준(ADMIN_IDLE_TIMEOUT_MS)을 넘긴 것 → 호출부에서 401.
 */
export async function checkAndTouchAdminActivity(
  supabase: SupabaseClient,
  email: string,
  lastSignInAt?: string | null
): Promise<{ expired: boolean }> {
  const key = seenKey(email);
  const now = Date.now();

  let last: number | null = null;
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
    const v = data?.value ? Number(data.value) : NaN;
    if (Number.isFinite(v)) last = v;
  } catch (e) {
    // 조회 실패 시 만료로 처리하면 관리자가 전부 잠기므로, 여기서는 통과시키고 시각만 새로 심는다.
    console.error('[admin-session] 활동시각 조회 실패:', e);
  }

  const signedIn = lastSignInAt ? Date.parse(lastSignInAt) : NaN;
  if (Number.isFinite(signedIn) && (last === null || signedIn > last)) last = signedIn;

  if (last !== null && now - last > ADMIN_IDLE_TIMEOUT_MS) {
    return { expired: true };
  }

  // 최초 접속(행 없음) 또는 갱신 주기 경과 → 현재 시각 기록
  if (last === null || now - last > TOUCH_THROTTLE_MS) {
    try {
      await supabase.from('app_settings').upsert(
        { key, value: String(now), description: `관리자 마지막 활동 시각(자동 로그아웃 판정) — ${email}` },
        { onConflict: 'key' }
      );
    } catch (e) {
      console.error('[admin-session] 활동시각 갱신 실패:', e);
    }
  }

  return { expired: false };
}

/** 로그아웃 시 활동 기록 제거(다음 로그인은 새 창으로 시작) */
export async function clearAdminActivity(supabase: SupabaseClient, email: string): Promise<void> {
  try {
    await supabase.from('app_settings').delete().eq('key', seenKey(email));
  } catch (e) {
    console.error('[admin-session] 활동시각 삭제 실패:', e);
  }
}
