'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const isLoginPage = pathname === '/admin/login';

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user && !isLoginPage) {
        router.replace('/admin/login');
        return;
      }
      setEmail(data.user?.email ?? null);
      setChecked(true);
    });
  }, [router, isLoginPage]);

  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/admin/login');
  };

  if (!checked && !isLoginPage) {
    return <div className="py-10 text-center text-slate-500">인증 확인 중...</div>;
  }

  if (isLoginPage) return <>{children}</>;

  return (
    <div className="-mx-4">
      <header className="bg-slate-800 text-white px-4 py-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="font-extrabold">🛡️ 관리자</span>
          <span className="text-xs text-slate-400 hidden sm:inline">{email}</span>
        </div>
        <button onClick={logout} className="text-sm text-slate-300 hover:text-white">
          로그아웃
        </button>
      </header>
      <nav className="bg-slate-700 text-slate-200 px-4 flex gap-1 overflow-x-auto text-sm">
        <NavLink href="/admin/dashboard">대시보드</NavLink>
        <NavLink href="/admin/completions">수료 현황</NavLink>
        <NavLink href="/admin/questions">시험문제</NavLink>
        <NavLink href="/admin/courses">교육 과정</NavLink>
      </nav>
      <div className="px-4 py-6">{children}</div>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname?.startsWith(href);
  return (
    <Link
      href={href}
      className={`whitespace-nowrap py-3 px-3 border-b-2 font-semibold transition ${
        active ? 'border-brand-light text-white' : 'border-transparent hover:text-white'
      }`}
    >
      {children}
    </Link>
  );
}
