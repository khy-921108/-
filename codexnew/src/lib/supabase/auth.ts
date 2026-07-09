import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { createServiceClient } from './server';
import type { AdminRole } from '@/lib/admin-permissions';

/**
 * 관리자 인증용 Supabase 서버 클라이언트 (쿠키 기반 세션).
 * Supabase Auth 로그인 사용자 중 **admins 허용목록(is_active)** 에 있는 사람만 관리자로 취급.
 */
export function createAuthClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set: (name: string, value: string, options: CookieOptions) => {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            /* RSC 환경에서 무시 */
          }
        },
        remove: (name: string, options: CookieOptions) => {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            /* */
          }
        },
      },
    }
  );
}

export interface AdminRecord {
  id: string;
  authUserId: string | null;
  email: string;
  role: AdminRole;
  permissions: string[];
  isActive: boolean;
  // R-6 ③-4: 등록 서명 프로필
  displayName: string | null;
  title: string | null;
  department: string | null;
  signature: string | null;
}

export type AdminAuthOk = { ok: true; user: { id: string; email: string }; admin: AdminRecord };
export type AdminAuthFail = { ok: false; response: NextResponse };
export type AdminAuthResult = AdminAuthOk | AdminAuthFail;

function unauthorized(message = '관리자 로그인이 필요합니다.'): AdminAuthFail {
  return {
    ok: false,
    response: NextResponse.json({ success: false, code: 'UNAUTHORIZED', message }, { status: 401 }),
  };
}
function forbidden(message = '이 기능에 대한 권한이 없습니다.'): AdminAuthFail {
  return {
    ok: false,
    response: NextResponse.json({ success: false, code: 'FORBIDDEN', message }, { status: 403 }),
  };
}

/**
 * 로그인 사용자의 이메일을 admins 허용목록과 대조.
 * - 인증 안 됨 → 401.
 * - admins 조회 실패(예: 007 미적용) → **fail-closed 401**(보안 우선).
 * - 허용목록에 없거나 비활성 → 401.
 * - 통과 시 admin 레코드 동반 반환.
 */
export async function requireAdmin(): Promise<AdminAuthResult> {
  const authClient = createAuthClient();
  const { data } = await authClient.auth.getUser();
  const user = data.user;
  if (!user || !user.email) {
    return unauthorized();
  }
  const email = user.email.toLowerCase();

  const svc = createServiceClient();
  const { data: row, error } = await svc
    .from('admins')
    .select('id, auth_user_id, email, role, permissions, is_active, display_name, title, department, signature')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    console.error('[requireAdmin] admins 조회 실패(허용목록 확인 불가):', error.message);
    return unauthorized('관리자 권한을 확인할 수 없습니다. (관리자에게 문의)');
  }
  if (!row || !row.is_active) {
    return unauthorized('등록된 관리자 계정이 아닙니다.');
  }

  const admin: AdminRecord = {
    id: row.id,
    authUserId: row.auth_user_id ?? null,
    email: row.email,
    role: row.role === 'SUPER' ? 'SUPER' : 'ADMIN',
    permissions: Array.isArray(row.permissions) ? (row.permissions as string[]) : [],
    isActive: !!row.is_active,
    displayName: row.display_name ?? null,
    title: row.title ?? null,
    department: row.department ?? null,
    signature: row.signature ?? null,
  };
  return { ok: true, user: { id: user.id, email }, admin };
}

/** SUPER 전용. */
export async function requireSuperAdmin(): Promise<AdminAuthResult> {
  const r = await requireAdmin();
  if (!r.ok) return r;
  if (r.admin.role !== 'SUPER') return forbidden('최고관리자(SUPER) 전용 기능입니다.');
  return r;
}

/** 특정 권한키 필요. SUPER 는 무조건 통과. ADMIN 은 permissions 에 key 가 있어야 통과. */
export async function requirePermission(key: string): Promise<AdminAuthResult> {
  const r = await requireAdmin();
  if (!r.ok) return r;
  if (r.admin.role === 'SUPER') return r; // SUPER all-pass
  if (!r.admin.permissions.includes(key)) return forbidden();
  return r;
}
