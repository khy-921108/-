import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { countPersonDevices, revokePersonDevices } from '@/lib/device';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code: string, message: string, status = 400) =>
  NextResponse.json({ success: false, code, message }, { status });

async function personOf(id: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('training_sessions')
    .select('name, birth_date, phone')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { supabase, person: null };
  return {
    supabase,
    person: { name: data.name as string, birthDate: String(data.birth_date).slice(0, 10), phone: data.phone as string },
  };
}

/** GET /api/admin/sessions/:id/devices — 이 수료자의 기억된 휴대폰 수 (권한 SESSION_DELETE) */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission('SESSION_DELETE');
  if (!auth.ok) return auth.response;
  if (!UUID_RE.test(ctx.params.id)) return fail('NOT_FOUND', '기록을 찾을 수 없습니다.', 404);
  try {
    const { supabase, person } = await personOf(ctx.params.id);
    if (!person) return fail('NOT_FOUND', '기록을 찾을 수 없습니다.', 404);
    const count = await countPersonDevices(supabase, person);
    return NextResponse.json({ success: true, data: { count } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[admin/sessions devices GET]', e?.message ?? 'unknown');
    return fail('QUERY_FAILED', '조회하지 못했습니다.', 500);
  }
}

/** DELETE /api/admin/sessions/:id/devices — 이 수료자의 기억된 휴대폰 모두 해제 (사유 ADMIN) */
export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission('SESSION_DELETE');
  if (!auth.ok) return auth.response;
  if (!UUID_RE.test(ctx.params.id)) return fail('NOT_FOUND', '기록을 찾을 수 없습니다.', 404);
  try {
    const { supabase, person } = await personOf(ctx.params.id);
    if (!person) return fail('NOT_FOUND', '기록을 찾을 수 없습니다.', 404);
    const revoked = await revokePersonDevices(supabase, person, 'ADMIN');
    return NextResponse.json({ success: true, data: { revoked } });
  } catch (e: any) {
    console.error('[admin/sessions devices DELETE]', e?.message ?? 'unknown');
    return fail('REVOKE_FAILED', '해제하지 못했습니다.', 500);
  }
}
