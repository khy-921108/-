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

/** 저장된 활동시각 + 마지막 로그인 시각 중 나중 것 */
async function effectiveLastSeen(
  supabase: SupabaseClient,
  key: string,
  lastSignInAt?: string | null
): Promise<number | null> {
  let last: number | null = null;
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
    const v = data?.value ? Number(data.value) : NaN;
    if (Number.isFinite(v)) last = v;
  } catch (e) {
    // 조회 실패로 전 관리자를 잠그지는 않는다(통과시키고 로그만 남김).
    console.error('[admin-session] 활동시각 조회 실패:', e);
  }
  const signedIn = lastSignInAt ? Date.parse(lastSignInAt) : NaN;
  if (Number.isFinite(signedIn) && (last === null || signedIn > last)) last = signedIn;
  return last;
}

/**
 * 만료 여부만 판정한다(**기록하지 않음**).
 *
 * 🔴 이 함수는 모든 관리자 요청에서 호출되지만 활동시각을 갱신하지 않는다.
 *    갱신까지 함께 하면 화면의 자동 새로고침(60초 폴링)·백그라운드 조회가 세션을 무한 연장해
 *    자리를 비워도 로그아웃되지 않는다(외부 설계검토 지적). 갱신은 touchAdminActivity 로 분리.
 *
 * 판정 기준 = max(저장된 활동시각, 마지막 로그인 시각).
 *  · 방금 로그인했으면 저장값이 오래됐어도 통과한다(전날 기록 때문에 바로 튕기는 것 방지).
 *  · lastSignInAt 은 **비밀번호 로그인에서만** 갱신되고 토큰 자동 갱신으로는 바뀌지 않으므로,
 *    남의 폰에 남아 있는 세션으로는 창을 새로 얻을 수 없다.
 *
 * @param lastSignInAt Supabase user.last_sign_in_at (ISO)
 */
export async function checkAdminActivity(
  supabase: SupabaseClient,
  email: string,
  lastSignInAt?: string | null
): Promise<{ expired: boolean }> {
  const last = await effectiveLastSeen(supabase, seenKey(email), lastSignInAt);
  if (last === null) return { expired: false }; // 기록도 로그인시각도 없으면 판정 불가 → 통과
  return { expired: Date.now() - last > ADMIN_IDLE_TIMEOUT_MS };
}

/**
 * 마지막 활동 시각을 현재로 갱신한다.
 *
 * 🔴 **사용자의 의미 있는 조작이 있었을 때만** 호출한다(/api/admin/heartbeat 전용).
 *    heartbeat 는 관리자 화면에서 클릭·키입력·스크롤·화면이동이 실제로 있었을 때만 전송된다.
 *    타이머가 도는 것만으로는 전송되지 않으므로, 방치된 화면은 그대로 만료된다.
 *
 * @returns expired=true 면 갱신 전에 이미 만료된 상태 → 호출부에서 401(연장 금지).
 */
export async function touchAdminActivity(
  supabase: SupabaseClient,
  email: string,
  lastSignInAt?: string | null
): Promise<{ expired: boolean }> {
  const key = seenKey(email);
  const now = Date.now();
  const last = await effectiveLastSeen(supabase, key, lastSignInAt);

  // 이미 만료된 세션은 되살리지 않는다
  if (last !== null && now - last > ADMIN_IDLE_TIMEOUT_MS) return { expired: true };

  // 최초 기록(행 없음) 또는 갱신 주기 경과 → 현재 시각 기록
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
