import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

/**
 * 관리자 인증용 Supabase 서버 클라이언트 (쿠키 기반 세션).
 * Supabase Auth에 이메일/비밀번호로 가입한 사용자를 관리자로 취급.
 */
export function createAuthClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: (name, value, options) => {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            /* RSC 환경에서 무시 */
          }
        },
        remove: (name, options) => {
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

export async function requireAdmin() {
  const supabase = createAuthClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, code: 'UNAUTHORIZED', message: '관리자 로그인이 필요합니다.' },
        { status: 401 }
      ),
    };
  }
  return { ok: true as const, user: data.user };
}
