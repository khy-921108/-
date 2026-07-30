'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ADMIN_IDLE_LABEL, ADMIN_SESSION_EXPIRED_MESSAGE } from '@/lib/admin-session';

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-slate-500">불러오는 중...</div>}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const expired = useSearchParams().get('expired') === '1';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError('이메일 또는 비밀번호가 올바르지 않습니다.');
        setLoading(false);
        return;
      }
      router.push('/admin/dashboard');
    } catch (e) {
      console.error(e);
      setError('로그인 중 오류가 발생했습니다.');
      setLoading(false);
    }
  };

  return (
    <main className="flex items-center justify-center min-h-[80vh]">
      <div className="card w-full max-w-sm space-y-5">
        <div className="text-center">
          <div className="text-3xl">🛡️</div>
          <h1 className="mt-2 text-xl font-bold text-slate-800">관리자 로그인</h1>
        </div>
        {expired && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            ⏱ {ADMIN_SESSION_EXPIRED_MESSAGE}
          </div>
        )}
        <div className="space-y-3">
          <div>
            <label className="label">이메일</label>
            <input
              type="email"
              className="input-base"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
            />
          </div>
          <div>
            <label className="label">비밀번호</label>
            <input
              type="password"
              className="input-base"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
        <button type="button" onClick={submit} disabled={loading} className="btn-primary">
          {loading ? '로그인 중...' : '로그인'}
        </button>
        <p className="text-xs text-slate-500 text-center">
          Supabase Authentication에 등록된 계정으로 로그인하세요.<br />
          {ADMIN_IDLE_LABEL} 동안 사용하지 않으면 자동으로 로그아웃됩니다.
        </p>
      </div>
    </main>
  );
}
