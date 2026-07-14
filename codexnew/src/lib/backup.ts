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

/** 필터 조건(build 콜백)으로 테이블 전체 행을 페이지네이션 조회. */
export async function fetchFiltered(
  supabase: SupabaseClient,
  table: string,
  cols: string,
  build: (q: any) => any
): Promise<any[]> {
  const out: any[] = [];
  const size = 1000;
  let from = 0;
  for (;;) {
    let q = supabase.from(table).select(cols);
    q = build(q);
    q = q.range(from, from + size - 1);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < size) break;
    from += size;
  }
  return out;
}

/** 조회 월(YYYY-MM) 검증·클램프 — 과거 무제한, 미래는 이번 달까지(KST). */
export function resolveMonth(monthRaw: string | null): string {
  const k = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const thisMonth = `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}`;
  let m = /^\d{4}-\d{2}$/.test(monthRaw ?? '') ? (monthRaw as string) : thisMonth;
  if (m > thisMonth) m = thisMonth;
  return m;
}

/** 월(+전/후반기) → 겹침 필터용 KST 범위 + 파일명 라벨. */
export function monthRange(month: string, half: 'H1' | 'H2' | null): { startIso: string; endIso: string; label: string } {
  const [y, mo] = month.split('-').map(Number);
  const lastDay = new Date(y, mo, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  let d1 = 1, d2 = lastDay, suffix = '';
  if (half === 'H1') { d1 = 1; d2 = Math.min(15, lastDay); suffix = '-전반기'; }
  else if (half === 'H2') { d1 = 16; d2 = lastDay; suffix = '-후반기'; }
  return {
    startIso: `${month}-${pad(d1)}T00:00:00+09:00`,
    endIso: `${month}-${pad(d2)}T23:59:59+09:00`,
    label: `${month}${suffix}`,
  };
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
