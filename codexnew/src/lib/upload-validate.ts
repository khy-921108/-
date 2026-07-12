/**
 * 업로드/서명 data URL 검증 (외부 보안검토 반영)
 *  - 서명: PNG data URL만 허용(SignaturePad 산출물). svg 등 스크립트 삽입 벡터 차단.
 *  - 사진: png/jpeg/webp만 허용. 용량 상한.
 */

const SIG_RE = /^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/;
const PHOTO_RE = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/;

export const MAX_SIG_BYTES = 2 * 1024 * 1024;   // 서명 2MB
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 사진 5MB

/** base64 data URL의 대략 바이트 수(용량 검사용) */
export function dataUrlBytes(s: string): number {
  const i = s.indexOf(',');
  if (i < 0) return 0;
  const b64 = s.slice(i + 1).replace(/\s/g, '');
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/** 서명 = PNG data URL + 용량 상한. (기존 startsWith('data:image/')는 svg 통과 → 강화) */
export function isValidSignature(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 4_000_000 && SIG_RE.test(s) && dataUrlBytes(s) <= MAX_SIG_BYTES;
}

/** 현장 사진 = png/jpeg/webp data URL. (용량은 호출부에서 buffer로 별도 검사) */
export function isValidPhoto(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 10_000_000 && PHOTO_RE.test(s);
}
