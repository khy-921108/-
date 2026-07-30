/**
 * 관리자 세션 자동 로그아웃 — 공용 상수 (클라이언트·서버 공용, 순수 값만)
 *
 * 🔴 만료 시간은 이 파일의 ADMIN_IDLE_TIMEOUT_MS 한 곳에서만 관리한다.
 *    (테스트할 때는 여기만 잠깐 줄였다가 반드시 2시간으로 되돌릴 것)
 *
 * 기준은 "로그인 후 2시간"이 아니라 **마지막 활동 후 2시간(무활동)** 이다.
 * 승인 작업을 계속하는 동안에는 튕기지 않는다.
 */

/** 무활동 자동 로그아웃 기준 — 2시간 */
export const ADMIN_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/** 화면 안내용 표기 (상수와 함께 바꾼다) */
export const ADMIN_IDLE_LABEL = '2시간';

/** 만료 안내 문구 */
export const ADMIN_SESSION_EXPIRED_MESSAGE =
  '장시간 사용하지 않아 자동 로그아웃되었습니다. 다시 로그인해 주세요.';

/** 만료 응답 코드 — 클라이언트가 이 코드를 보면 signOut 후 로그인 화면으로 보낸다 */
export const ADMIN_SESSION_EXPIRED_CODE = 'SESSION_EXPIRED';

/** 클라이언트 활동 감시 주기(ms) — 이 간격으로 만료 확인 + 서버 활동시각 갱신 */
export const ADMIN_HEARTBEAT_INTERVAL_MS = 60 * 1000;
