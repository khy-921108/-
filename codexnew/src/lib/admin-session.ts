/**
 * 관리자 세션 자동 로그아웃 — 공용 상수 (클라이언트·서버 공용, 순수 값만)
 *
 * 🔴 만료 시간은 이 파일의 ADMIN_IDLE_TIMEOUT_MS 한 곳에서만 관리한다.
 *    (테스트할 때는 여기만 잠깐 줄였다가 반드시 8시간으로 되돌릴 것)
 *
 * 기준은 "로그인 후 8시간"이 아니라 **마지막 활동 후 8시간(무활동)** 이다.
 * 승인 작업을 계속하는 동안에는 튕기지 않는다.
 */

/** 무활동 자동 로그아웃 기준 — 8시간(관리자 1~2명 소규모 운영. 사실상 근무일 1일) */
export const ADMIN_IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;

/** 화면 안내용 표기 (상수와 함께 바꾼다) */
export const ADMIN_IDLE_LABEL = '8시간';

/** 만료 안내 문구 */
export const ADMIN_SESSION_EXPIRED_MESSAGE =
  '장시간 사용하지 않아 자동 로그아웃되었습니다. 다시 로그인해 주세요.';

/** 만료 응답 코드 — 클라이언트가 이 코드를 보면 signOut 후 로그인 화면으로 보낸다 */
export const ADMIN_SESSION_EXPIRED_CODE = 'SESSION_EXPIRED';

/** 클라이언트 활동 감시 주기(ms) — 이 간격으로 만료 확인 + 서버 활동시각 갱신 */
export const ADMIN_HEARTBEAT_INTERVAL_MS = 60 * 1000;

// ──────────────────────────────────────────────────────────────
// 탭 간 활동시각 공유 (클라이언트 전용)
//
// 🔴 탭마다 자기 화면의 활동만 보고 판정하면, 방치된 탭 하나가 작업 중인 탭까지
//    로그아웃시킨다(signOut 은 브라우저 전체 세션을 지우기 때문). 그래서 마지막 조작 시각을
//    localStorage 로 공유해 **어느 탭에서 조작하든 모든 탭이 같은 값을 본다.**
//    활동으로 인정하는 범위는 그대로 — 사용자의 실제 조작(클릭·키입력·스크롤·터치)뿐이고
//    자동 폴링·백그라운드 조회는 여기에 기록되지 않는다.
// ──────────────────────────────────────────────────────────────

/** 탭 간 공유 활동시각 저장 키 */
export const ADMIN_ACTIVITY_KEY = 'wp_admin_activity';

/** 공유 활동시각 기록(쓰기 폭주 방지를 위해 호출부에서 5초 정도 간격을 둔다) */
export function writeSharedActivity(ts: number = Date.now()): void {
  try { localStorage.setItem(ADMIN_ACTIVITY_KEY, String(ts)); } catch { /* 프라이빗 모드 등 */ }
}

/** 공유 활동시각 읽기 — 없으면 0(호출부에서 자기 탭 값과 max 로 합친다) */
export function readSharedActivity(): number {
  try {
    const v = Number(localStorage.getItem(ADMIN_ACTIVITY_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
}
