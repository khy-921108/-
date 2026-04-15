import { createServiceClient } from './supabase/server';

/**
 * 수료번호 생성: {PREFIX}-YYYYMMDD-NNNN
 * 동일 날짜 내 일련번호를 4자리로 부여.
 */
export async function generateCompletionNumber(prefix: string): Promise<string> {
  const supabase = createServiceClient();
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}${m}${d}`;

  const startOfDay = new Date(y, now.getMonth(), now.getDate()).toISOString();
  const endOfDay = new Date(y, now.getMonth(), now.getDate() + 1).toISOString();

  const { count } = await supabase
    .from('completions')
    .select('*', { count: 'exact', head: true })
    .gte('completed_at', startOfDay)
    .lt('completed_at', endOfDay);

  const seq = String((count ?? 0) + 1).padStart(4, '0');
  return `${prefix}-${dateStr}-${seq}`;
}
