'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface MeData {
  email: string;
  role: 'SUPER' | 'ADMIN';
  permissions: string[]; // SUPER 는 ['*']
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [me, setMe] = useState<MeData | null>(null);
  const [denied, setDenied] = useState(false);
  const [checked, setChecked] = useState(false);

  const isLoginPage = pathname === '/admin/login';

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user && !isLoginPage) {
        router.replace('/admin/login');
        return;
      }
      setEmail(data.user?.email ?? null);
      if (data.user && !isLoginPage) {
        try {
          const res = await fetch('/api/admin/me');
          const json = await res.json();
          if (json.success) setMe(json.data);
          else setDenied(true); // 로그인은 됐으나 허용목록에 없음
        } catch {
          setDenied(true);
        }
      }
      setChecked(true);
    });
  }, [router, isLoginPage]);

  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/admin/login');
  };

  const isSuper = me?.role === 'SUPER';
  const can = (key: string) => !!me && (isSuper || me.permissions.includes(key));

  if (!checked && !isLoginPage) {
    return <div className="py-10 text-center text-slate-500">인증 확인 중...</div>;
  }

  if (isLoginPage) return <>{children}</>;

  // 로그인은 됐지만 등록된 관리자가 아님 → 차단 안내(잠김 가시화)
  if (denied) {
    return (
      <div className="-mx-4">
        <header className="bg-slate-800 text-white px-4 py-3 flex justify-between items-center">
          <span className="font-extrabold">🛡️ 관리자</span>
          <button onClick={logout} className="text-sm text-slate-300 hover:text-white">로그아웃</button>
        </header>
        <div className="px-4 py-16 text-center space-y-3">
          <p className="text-2xl">🚫</p>
          <p className="font-bold text-slate-800">등록된 관리자 계정이 아닙니다.</p>
          <p className="text-sm text-slate-500">
            {email}<br />
            이 계정은 관리자 권한이 없습니다. 최고관리자에게 권한 등록을 요청하세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="-mx-4">
      <header className="bg-slate-800 text-white px-4 py-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="font-extrabold">🛡️ 관리자</span>
          <span className="text-xs text-slate-400 hidden sm:inline">
            {email}{isSuper ? ' · 최고관리자' : ''}
          </span>
        </div>
        <button onClick={logout} className="text-sm text-slate-300 hover:text-white">
          로그아웃
        </button>
      </header>
      <nav className="bg-slate-700 text-slate-200 px-4 flex gap-1 overflow-x-auto text-sm">
        <NavLink href="/admin/dashboard">대시보드</NavLink>
        {can('COMPLETIONS_VIEW') && <NavLink href="/admin/completions">수료 현황</NavLink>}
        {can('COMPANIES_VIEW') && <NavLink href="/admin/companies">업체 관리</NavLink>}
        {can('WORKPERMITS_VIEW') && <NavLink href="/admin/work-permits">작업허가</NavLink>}
        {can('QUESTIONS_MANAGE') && <NavLink href="/admin/questions">시험문제</NavLink>}
        {can('COURSES_MANAGE') && <NavLink href="/admin/courses">교육 과정</NavLink>}
        {isSuper && <NavLink href="/admin/admins">관리자</NavLink>}
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
