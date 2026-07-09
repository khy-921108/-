import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const fetchCache = 'force-no-store';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function withTimeout<T>(p: PromiseLike<T>, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT:${label}`)), 12000)),
  ]);
}

/**
 * GET /api/admin/work-permits/:id/tbm-photos  (requireAdmin) — R-6 게이트③-2c
 * TBM 현장 사진(비공개 버킷 경로)을 임시 signed URL 로 반환해 관리자 상세화면 썸네일에 사용.
 * ("보고 승인" — 안전환경이 2차 서명 전 실제 사진 확인)
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const supabase = createServiceClient();
  try {
  const { data: permit, error } = await withTimeout(
    supabase.from('work_permits').select('id, tbm').eq('id', ctx.params.id).maybeSingle(),
    'select'
  );

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
      const { data: signed, error: sErr } = await withTimeout(
        supabase.storage.from('work-permit-photos').createSignedUrl(p, 600),
        'sign'
      );
      if (!sErr && signed?.signedUrl) urls.push(signed.signedUrl);
    } catch (e) {
      console.error('[tbm-photos] sign:', e);
    }
  }
  return NextResponse.json({ success: true, data: { urls } });
  } catch (e) {
    const msg = (e as Error)?.message ?? '';
    const timeout = msg.startsWith('TIMEOUT');
    return NextResponse.json(
      { success: false, code: timeout ? 'TIMEOUT' : 'SERVER_ERROR', message: timeout ? '조회 지연' : '서버 오류' },
      { status: timeout ? 504 : 500 }
    );
  }
}
