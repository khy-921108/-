import type { SupabaseClient } from '@supabase/supabase-js';

/** 테이블 전체 행을 페이지네이션(1000행 캡)으로 모두 조회. */
export async function fetchAllRows(supabase: SupabaseClient, table: string, cols = '*'): Promise<any[]> {
  const out: any[] = [];
  const size = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < size) break;
    from += size;
  }
  return out;
}

/** KST 타임스탬프(파일명·요약용). */
export function kstStamp(): { ymd: string; full: string } {
  const k = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const ymd = `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`;
  const full = `${ymd} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
  return { ymd, full };
}

/** ExcelJS 워크시트에 행 배열을 헤더+데이터로 채움(객체/긴 값 안전 처리). */
export function addSheet(wb: any, name: string, rows: any[]): void {
  const ws = wb.addWorksheet(name.slice(0, 31));
  if (!rows || rows.length === 0) { ws.addRow(['(데이터 없음)']); return; }
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  ws.addRow(cols);
  for (const r of rows) {
    ws.addRow(cols.map((c) => {
      const v = r[c];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v).slice(0, 32000);
      if (typeof v === 'string') return v.slice(0, 32000);
      return v;
    }));
  }
}

/** attachment 응답 헤더(한글 파일명 안전). */
export function zipHeaders(filename: string): Record<string, string> {
  return {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="backup.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store',
  };
}
