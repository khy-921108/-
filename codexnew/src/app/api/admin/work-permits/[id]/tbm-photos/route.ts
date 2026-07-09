import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const fetchCache = 'force-no-store';

/**
 * GET /api/admin/work-permits/:id/tbm-photos  (requireAdmin) — R-6 게이트③-2c
 * TBM 현장 사진(비공개 버킷 경로)을 임시 signed URL 로 반환해 관리자 상세화면 썸네일에 사용.
 * ("보고 승인" — 안전환경이 2차 서명 전 실제 사진 확인)
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const supabase = createServiceClient();
  const { data: permit, error } = await supabase
    .from('work_permits')
    .select('id, tbm')
    .eq('id', ctx.params.id)
    .maybeSingle();

  if (error) {
    console.error('[tbm-photos] read:', error);
    return NextResponse.json({ success: false, code: 'QUERY_FAILED', message: '조회 오류' }, { status: 500 });
  }
  if (!permit) {
    return NextResponse.json({ success: false, code: 'NOT_FOUND', message: '허가서를 찾을 수 없습니다.' }, { status: 404 });
  }

  const tbm = (permit.tbm ?? {}) as Record<string, any>;
  const paths: string[] = Array.isArray(tbm.photos) ? tbm.photos : [];
  const urls: string[] = [];
  for (const p of paths) {
    try {
      const { data: signed, error: sErr } = await supabase.storage
        .from('work-permit-photos')
        .createSignedUrl(p, 600); // 10분
      if (!sErr && signed?.signedUrl) urls.push(signed.signedUrl);
    } catch (e) {
      console.error('[tbm-photos] sign:', e);
    }
  }
  return NextResponse.json({ success: true, data: { urls } });
}
