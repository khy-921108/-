import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 작업허가 신청번호 발급 — YYYYMMDD-NNN (KST).
 * - Postgres RPC next_work_permit_number()로 **원자적** 발급(동시 제출 race 방지).
 * - work_permits.permit_number UNIQUE 백스톱 + 호출 측 INSERT 충돌 시 최대 3회 재시도는
 *   호출자(POST /api/work-permits)에서 처리. 여기서는 번호 문자열만 발급.
 * - count 방식은 동시성 race가 있어 폐기.
 */
export async function generateWorkPermitNumber(
  supabase: SupabaseClient
): Promise<string> {
  const { data, error } = await supabase.rpc('next_work_permit_number');
  if (error || !data) {
    console.error('[work-permit-number] rpc error:', error);
    throw new Error('NUMBER_RPC_FAILED');
  }
  return String(data);
}
