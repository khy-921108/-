import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { fetchFiltered, resolveMonth, monthRange, kstStamp, zipHeaders } from '@/lib/backup';
import JSZip from 'jszip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

/**
 * GET /api/admin/backup/photos?month=YYYY-MM[&half=H1|H2]  (SUPER 전용)
 * 선택 월 허가서의 TBM 현장 사진 원본 zip. 데이터와 분리(사진 누적 시 zip이 큼).
 */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const supabase = createServiceClient();

  const url = new URL(req.url);
  const month = resolveMonth(url.searchParams.get('month'));
  const half = (['H1', 'H2'].includes(url.searchParams.get('half') || '') ? url.searchParams.get('half') : null) as 'H1' | 'H2' | null;
  const { startIso, endIso, label } = monthRange(month, half);

  try {
    const permits = await fetchFiltered(supabase, 'work_permits', 'id, permit_number, tbm', (q) =>
      q.lte('work_start', endIso).gte('work_end', startIso).order('work_start', { ascending: true })
    );
    const targets: { key: string; permit: string }[] = [];
    for (const p of permits) {
      const photos = (p.tbm ?? {}).photos;
      if (Array.isArray(photos)) for (const k of photos) if (typeof k === 'string' && k) targets.push({ key: k, permit: p.permit_number });
    }

    const zip = new JSZip();
    const manifest: string[] = [];
    let ok = 0, fail = 0;
    for (const { key, permit } of targets) {
      const { data, error } = await supabase.storage.from('work-permit-photos').download(key);
      if (error || !data) { fail++; manifest.push(`FAIL  ${permit}  ${key}  (${error?.message ?? 'no data'})`); continue; }
      const ab = await data.arrayBuffer();
      zip.file(`photos/${key}`, new Uint8Array(ab));
      ok++; manifest.push(`OK    ${permit}  ${key}`);
    }

    const { full } = kstStamp();
    zip.file('사진목록.txt',
      `동남 울산공장 TBM 현장 사진 백업\n대상 월: ${label}\n생성 시각: ${full} (KST) · 생성자: ${auth.admin.email}\n` +
      `----------------------------------------\n허가서 ${permits.length}건 · 사진 대상 ${targets.length}장 · 성공 ${ok} · 실패 ${fail}\n` +
      `----------------------------------------\n${manifest.join('\n')}\n`);

    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    return new Response(new Uint8Array(buf), { headers: zipHeaders(`safety-edu-사진백업-${label}.zip`) });
  } catch (e: any) {
    console.error('[backup/photos]', e);
    return NextResponse.json({ success: false, code: 'BACKUP_FAILED', message: e?.message ?? '사진 백업 실패' }, { status: 500 });
  }
}
