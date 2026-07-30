'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  ADMIN_HEARTBEAT_INTERVAL_MS,
  ADMIN_IDLE_TIMEOUT_MS,
  ADMIN_SESSION_EXPIRED_CODE,
} from '@/lib/admin-session';

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

  // ── 무활동 자동 로그아웃(2시간) — 상수는 lib/admin-session.ts 한 곳 ──
  // 클라이언트는 "편의"만 담당하고, 최종 판정은 서버(requireAdmin)가 한다.
  const lastActivityRef = useRef(Date.now());
  const lastPingRef = useRef(0);

  const expireSession = useCallback(async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch { /* */ }
    router.replace('/admin/login?expired=1');
  }, [router]);

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
          else if (json.code === ADMIN_SESSION_EXPIRED_CODE) { await expireSession(); return; }
          else setDenied(true); // 로그인은 됐으나 허용목록에 없음
        } catch {
          setDenied(true);
        }
      }
      setChecked(true);
    });
  }, [router, isLoginPage, expireSession]);

  // 🔴 활동으로 인정하는 것 = 사용자의 실제 조작뿐(클릭·키입력·스크롤·터치).
  //    화면의 자동 새로고침·백그라운드 조회·타이머는 여기에 걸리지 않으므로 세션을 연장하지 못한다.
  //    (자동 갱신되는 화면을 열어둔 채 자리를 비우면 2시간 뒤 그대로 로그아웃된다)
  useEffect(() => {
    if (isLoginPage) return;
    const mark = () => { lastActivityRef.current = Date.now(); };
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));

    const timer = setInterval(async () => {
      const idle = Date.now() - lastActivityRef.current;
      if (idle > ADMIN_IDLE_TIMEOUT_MS) { await expireSession(); return; }
      // 마지막 확인 이후 실제 활동이 있었을 때만 서버 활동시각을 갱신한다
      if (lastActivityRef.current <= lastPingRef.current) return;
      lastPingRef.current = Date.now();
      try {
        const res = await fetch('/api/admin/heartbeat', { method: 'POST' });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          if (json?.code === ADMIN_SESSION_EXPIRED_CODE) await expireSession();
        }
      } catch { /* 네트워크 오류는 무시 — 서버가 최종 판정 */ }
    }, ADMIN_HEARTBEAT_INTERVAL_MS);

    return () => {
      events.forEach((e) => window.removeEventListener(e, mark));
      clearInterval(timer);
    };
  }, [isLoginPage, expireSession]);

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
      <nav className="bg-slate-700 text-slate-200 px-4 flex flex-wrap gap-1 text-sm">
        <NavLink href="/admin/dashboard">대시보드</NavLink>
        {can('COMPLETIONS_VIEW') && <NavLink href="/admin/completions">수료 현황</NavLink>}
        {can('COMPANIES_VIEW') && <NavLink href="/admin/companies">업체 관리</NavLink>}
        {can('WORKPERMITS_VIEW') && <NavLink href="/admin/work-permits">작업허가</NavLink>}
        {can('QUESTIONS_MANAGE') && <NavLink href="/admin/questions">시험문제</NavLink>}
        {can('COURSES_MANAGE') && <NavLink href="/admin/courses">교육 과정</NavLink>}
        {isSuper && <NavLink href="/admin/admins">관리자</NavLink>}
        <NavLink href="/admin/settings">내 정보</NavLink>
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
