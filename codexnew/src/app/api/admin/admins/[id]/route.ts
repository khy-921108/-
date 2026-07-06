import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sanitizePermissions } from '@/lib/admin-permissions';

export const runtime = 'nodejs';

/**
 * PATCH /api/admin/admins/:id  (requireSuperAdmin)
 * - permissions(부여가능만) / is_active 수정. role 은 변경하지 않음(SUPER 승격·강등 불가).
 * - 🔒 본인 비활성 차단 / 마지막 활성 SUPER 비활성 차단.
 * req: { permissions?: string[], isActive?: boolean }
 */
export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const targetId = ctx.params.id;
  const supabase = createServiceClient();

  const { data: target, error: selErr } = await supabase
    .from('admins')
    .select('id, email, role, is_active')
    .eq('id', targetId)
    .maybeSingle();
  if (selErr) {
    console.error('[admins PATCH] select:', selErr);
    return NextResponse.json({ success: false, code: 'QUERY_FAILED', message: selErr.message }, { status: 500 });
  }
  if (!target) {
    return NextResponse.json({ success: false, code: 'NOT_FOUND', message: '관리자를 찾을 수 없습니다.' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};

  if (Array.isArray(body.permissions)) {
    update.permissions = sanitizePermissions(body.permissions);
  }

  if (typeof body.isActive === 'boolean') {
    if (body.isActive === false) {
      // 본인 비활성 차단
      if (target.email === auth.admin.email) {
        return NextResponse.json({ success: false, code: 'CANNOT_DISABLE_SELF', message: '본인 계정은 비활성화할 수 없습니다.' }, { status: 400 });
      }
      // 마지막 활성 SUPER 비활성 차단
      if (target.role === 'SUPER' && target.is_active) {
        const { count } = await supabase
          .from('admins')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'SUPER')
          .eq('is_active', true);
        if ((count ?? 0) <= 1) {
          return NextResponse.json({ success: false, code: 'LAST_SUPER', message: '마지막 활성 최고관리자는 비활성화할 수 없습니다.' }, { status: 400 });
        }
      }
    }
    update.is_active = body.isActive;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: false, code: 'NOTHING_TO_UPDATE', message: '변경할 항목이 없습니다.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('admins')
    .update(update)
    .eq('id', targetId)
    .select('id, email, role, permissions, is_active')
    .single();
  if (error || !data) {
    console.error('[admins PATCH] update:', error);
    return NextResponse.json({ success: false, code: 'UPDATE_FAILED', message: error?.message ?? '수정 실패' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      id: data.id,
      email: data.email,
      role: data.role,
      permissions: Array.isArray(data.permissions) ? data.permissions : [],
      isActive: data.is_active,
    },
  });
}
