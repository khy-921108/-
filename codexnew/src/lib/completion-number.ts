import { createServiceClient } from './supabase/server';

/**
 * 수료번호 생성: {PREFIX}-YYYYMMDD-NNNN
 * 오늘 날짜 번호 중 가장 큰 일련번호 + 1.
 * 🔴 건수 + 1 로 만들면 수료 기록을 지운 뒤 번호가 겹쳐 수료가 실패한다.
 *    지워진 번호도 재사용하지 않도록 삭제 로그(training_record_logs)까지 함께 본다.
 */
export async function generateCompletionNumber(prefix: string): Promise<string> {
  const supabase = createServiceClient();
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const head = `${prefix}-${y}${m}${d}-`;

  const [issued, logged] = await Promise.all([
    supabase.from('completions').select('completion_number').like('completion_number', `${head}%`),
    supabase.from('training_record_logs').select('completion_number').like('completion_number', `${head}%`),
  ]);
  if (issued.error) throw issued.error;
  if (logged.error) throw logged.error;

  let max = 0;
  for (const row of [...(issued.data ?? []), ...(logged.data ?? [])]) {
    const n = parseInt(String(row.completion_number).slice(head.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }

  return `${head}${String(max + 1).padStart(4, '0')}`;
}
