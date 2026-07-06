import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';

export const runtime = 'nodejs';

/**
 * GET /api/admin/me  (requireAdmin)
 * - 현재 로그인 관리자의 역할·권한 반환. 화면(네비 노출 판단)·권한 표시에 사용.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    success: true,
    data: {
      email: auth.admin.email,
      role: auth.admin.role,
      permissions: auth.admin.role === 'SUPER' ? ['*'] : auth.admin.permissions,
    },
  });
}
