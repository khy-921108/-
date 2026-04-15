'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function AdminLoginPage() {
  const router = useRouter();
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
          Supabase Authentication에 등록된 계정으로 로그인하세요.
        </p>
      </div>
    </main>
  );
}
