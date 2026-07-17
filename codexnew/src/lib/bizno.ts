/**
 * 사업자등록번호 유틸(클라이언트 안전 — 순수 함수만).
 * 포맷(000-00-00000)·체크섬·상태 라벨. 국세청 호출은 bizno-server.ts.
 * 등록·수정·엑셀·승인 모든 문에서 이 검증 하나로 동일 적용.
 */

/** 숫자만 추출 */
export function bizNoDigits(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[^0-9]/g, '') : '';
}

/** 표시용 하이픈 포맷(000-00-00000). 10자리 미만이면 입력 중 부분 포맷 */
export function formatBizNo(v: string): string {
  const d = bizNoDigits(v).slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/**
 * 국세청 사업자등록번호 체크섬 검증.
 * 10자리 + 가중치(1,3,7,1,3,7,1,3,5). 형식상 불가능한 번호(0000000000 등)를 걸러냄.
 */
export function isValidBizNo(v: unknown): boolean {
  const d = bizNoDigits(v as string);
  if (d.length !== 10) return false;
  // 열 자리 전부 같은 숫자(0000000000 등) = 명백한 가짜 → 체크섬 계산 전 즉시 거부(국세청 호출 낭비 차단)
  if (/^(\d)\1{9}$/.test(d)) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * w[i];
  sum += Math.floor((Number(d[8]) * 5) / 10);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(d[9]);
}

/** 국세청 b_stt_cd → 표시 라벨 */
export function bizStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case '01': return '계속사업자';
    case '02': return '휴업자';
    case '03': return '폐업자';
    case 'NONE': return '등록되지 않은 번호';
    default: return status || '';
  }
}
