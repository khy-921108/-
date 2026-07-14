import { NextResponse } from 'next/server';
import { requireAdmin, requireSuperAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const KEY = 'BACKUP_GUIDE';
const DEFAULT_GUIDE = '매월 그 달치를 다운로드해 회사 NAS(안전환경부서자료 폴더)에 보관하세요. 서류 3년 보존 의무 대응.';

/** GET — 백업 안내 문구 조회(관리자). */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const supabase = createServiceClient();
  const { data } = await supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle();
  return NextResponse.json({ success: true, data: { guide: data?.value ?? DEFAULT_GUIDE } });
}

/** PATCH — 백업 안내 문구 수정(SUPER 전용). app_settings.value VARCHAR(200). */
export async function PATCH(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({}));
  const guide = (typeof body?.guide === 'string' ? body.guide : '').trim().slice(0, 200);
  if (!guide) return NextResponse.json({ success: false, code: 'EMPTY', message: '안내 문구를 입력해 주세요.' }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: KEY, value: guide, description: '전체 백업 다운로드 안내 문구' }, { onConflict: 'key' });
  if (error) {
    console.error('[backup-guide PATCH]', error);
    return NextResponse.json({ success: false, code: 'SAVE_FAILED', message: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: { guide } });
}
