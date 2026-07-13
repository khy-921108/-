import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { fetchAllRows, kstStamp, zipHeaders } from '@/lib/backup';
import JSZip from 'jszip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

/**
 * GET /api/admin/backup/photos  (SUPER 전용)
 * TBM 현장 사진 전부 zip — work_permits.tbm.photos 의 스토리지 키를 원본 파일로 내려받아 묶음.
 * 데이터와 분리(사진 누적 시 zip이 커서 한 번에 못 만들 수 있음 → 데이터/사진 2버튼).
 */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const supabase = createServiceClient();

  try {
    const permits = await fetchAllRows(supabase, 'work_permits', 'id, permit_number, tbm');
    const targets: { key: string; permit: string }[] = [];
    for (const p of permits) {
      const photos = (p.tbm ?? {}).photos;
      if (Array.isArray(photos)) {
        for (const k of photos) if (typeof k === 'string' && k) targets.push({ key: k, permit: p.permit_number });
      }
    }

    const zip = new JSZip();
    const manifest: string[] = [];
    let ok = 0, fail = 0;
    for (const { key, permit } of targets) {
      const { data, error } = await supabase.storage.from('work-permit-photos').download(key);
      if (error || !data) { fail++; manifest.push(`FAIL  ${permit}  ${key}  (${error?.message ?? 'no data'})`); continue; }
      const ab = await data.arrayBuffer();
      zip.file(`photos/${key}`, new Uint8Array(ab)); // jpeg=이미 압축 → STORE
      ok++; manifest.push(`OK    ${permit}  ${key}`);
    }

    const { ymd, full } = kstStamp();
    zip.file('사진목록.txt',
      `동남 울산공장 TBM 현장 사진 백업\n생성 시각: ${full} (KST) · 생성자: ${auth.admin.email}\n` +
      `----------------------------------------\n대상 ${targets.length}장 · 성공 ${ok} · 실패 ${fail}\n` +
      `----------------------------------------\n${manifest.join('\n')}\n`);

    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
    return new Response(new Uint8Array(buf), { headers: zipHeaders(`safety-edu-사진백업-${ymd}.zip`) });
  } catch (e: any) {
    console.error('[backup/photos]', e);
    return NextResponse.json({ success: false, code: 'BACKUP_FAILED', message: e?.message ?? '사진 백업 실패' }, { status: 500 });
  }
}
