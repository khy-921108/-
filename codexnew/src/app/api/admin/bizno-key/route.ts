import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const KEY = 'BIZNO_API_KEY';

/** 앞 4자만 노출 마스킹(abcd****) */
function mask(v: string): string {
  if (!v) return '';
  return v.slice(0, 4) + '*'.repeat(Math.max(4, Math.min(12, v.length - 4)));
}

/** GET — 키 설정 여부 + 마스킹 표시(SUPER). 원문 반환 금지. */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const supabase = createServiceClient();
  const { data } = await supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle();
  const v = (data?.value ?? '').trim();
  return NextResponse.json({ success: true, data: { set: !!v, masked: mask(v) } });
}

/** PATCH — 키 저장/삭제(SUPER). body { key } (빈 문자열 = 삭제). value VARCHAR(200). */
export async function PATCH(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const key = (typeof body?.key === 'string' ? body.key : '').trim().slice(0, 200);

  const supabase = createServiceClient();
  const { error } = await supabase.from('app_settings').upsert(
    { key: KEY, value: key, description: '국세청 사업자등록 상태조회 API 키(공공데이터포털)' },
    { onConflict: 'key' }
  );
  if (error) {
    console.error('[bizno-key PATCH]', error);
    return NextResponse.json({ success: false, code: 'SAVE_FAILED', message: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: { set: !!key, masked: mask(key) } });
}
