import { createClient } from '@supabase/supabase-js';

/**
 * 서버 전용 Supabase 클라이언트 (Service Role Key 사용).
 * 반드시 서버 코드(API Route, Server Component)에서만 호출할 것.
 * 클라이언트 컴포넌트에서 import 하면 키가 브라우저로 노출됩니다.
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}
