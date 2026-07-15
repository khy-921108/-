import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const K_BODY = 'HOME_NOTICE';
const K_AT = 'HOME_NOTICE_AT';

/** GET — 홈 공지 조회(SUPER). { notice, at } */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const supabase = createServiceClient();
  const { data } = await supabase.from('app_settings').select('key, value').in('key', [K_BODY, K_AT]);
  const map = new Map((data ?? []).map((r: any) => [r.key, r.value]));
  return NextResponse.json({ success: true, data: { notice: map.get(K_BODY) ?? '', at: map.get(K_AT) ?? '' } });
}

/**
 * PATCH — 홈 공지 저장/내리기(SUPER). body { notice }.
 * 비우면 공지 없음. 저장 시 HOME_NOTICE_AT=현재시각(버전) 갱신. app_settings.value VARCHAR(200).
 */
export async function PATCH(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const notice = (typeof body?.notice === 'string' ? body.notice : '').trim().slice(0, 200);
  const at = new Date().toISOString();

  const supabase = createServiceClient();
  const { error } = await supabase.from('app_settings').upsert(
    [
      { key: K_BODY, value: notice, description: '홈 공지 본문' },
      { key: K_AT, value: at, description: '홈 공지 수정 시각(버전)' },
    ],
    { onConflict: 'key' }
  );
  if (error) {
    console.error('[home-notice PATCH]', error);
    return NextResponse.json({ success: false, code: 'SAVE_FAILED', message: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: { notice, at } });
}
