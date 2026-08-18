import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import { createServiceClient } from './server';
import type { AdminRole } from '@/lib/admin-permissions';
import { ADMIN_SESSION_EXPIRED_CODE, ADMIN_SESSION_EXPIRED_MESSAGE } from '@/lib/admin-session';
import { checkAdminActivity } from '@/lib/admin-session-server';

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

export type AdminAuthOk = { ok: true; user: { id: string; email: string; lastSignInAt: string | null }; admin: AdminRecord };
export type AdminAuthFail = { ok: false; response: NextResponse };
export type AdminAuthResult = AdminAuthOk | AdminAuthFail;

function unauthorized(message = '관리자 로그인이 필요합니다.'): AdminAuthFail {
  return {
    ok: false,
    response: NextResponse.json({ success: false, code: 'UNAUTHORIZED', message }, { status: 401 }),
  };
}
function sessionExpired(): AdminAuthFail {
  return {
    ok: false,
    response: NextResponse.json(
      { success: false, code: ADMIN_SESSION_EXPIRED_CODE, message: ADMIN_SESSION_EXPIRED_MESSAGE },
      { status: 401 }
    ),
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

  // 무활동 자동 로그아웃 — 서버가 최종 판정(클라이언트 타이머 우회 방지).
  // 🔴 여기서는 **판정만** 한다. 세션 연장(활동시각 갱신)은 /api/admin/heartbeat 에서만 일어난다.
  //    모든 요청이 세션을 연장하면 화면의 자동 새로고침만으로 무한 연장돼 로그아웃이 무력화된다.
  const { expired } = await checkAdminActivity(svc, email, user.last_sign_in_at);
  if (expired) return sessionExpired();

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
  return { ok: true, user: { id: user.id, email, lastSignInAt: user.last_sign_in_at ?? null }, admin };
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
