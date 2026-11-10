/**
 * 국내 휴대폰·전화번호 정규화.
 * - 숫자만 남긴다.
 * - 휴대폰 자동완성이 "+82 10-1234-5678"처럼 국가번호를 붙여 넣는 경우가 있어,
 *   82로 시작하는 11~12자리는 앞의 82를 0으로 바꾼다.
 * - 최대 11자리.
 * 예: "+82 10-1234-5678" → "01012345678", "010-1234-5678" → "01012345678"
 */
export function normalizeKrPhone(value: unknown): string {
  let d = typeof value === 'string' ? value.replace(/[^0-9]/g, '') : '';
  if (d.startsWith('82') && d.length >= 11 && d.length <= 12) d = '0' + d.slice(2);
  return d.slice(0, 11);
}
