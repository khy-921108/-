'use client';

import { useEffect, useState } from 'react';
import { ADMIN_PERMISSIONS, DEFAULT_PERMISSIONS } from '@/lib/admin-permissions';

interface AdminItem {
  id: string;
  email: string;
  role: 'SUPER' | 'ADMIN';
  permissions: string[];
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  displayName: string;
  title: string;
  department: string;
}

// ADMIN 에게 부여 가능한 권한(기본+선택) — SUPER 전용 제외
const GRANTABLE = ADMIN_PERMISSIONS.filter((p) => p.group !== 'super');

export default function AdminsPage() {
  const [role, setRole] = useState<'SUPER' | 'ADMIN' | null>(null);
  const [items, setItems] = useState<AdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createdPw, setCreatedPw] = useState<{ email: string; password: string } | null>(null);

  const loadMe = async () => {
    try {
      const res = await fetch('/api/admin/me');
      const json = await res.json();
      if (json.success) setRole(json.data.role);
    } catch { /* */ }
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/admins');
      const json = await res.json();
      if (json.success) setItems(json.data.items);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMe();
    load();
  }, []);

  if (role !== null && role !== 'SUPER') {
    return (
      <div className="py-16 text-center space-y-2">
        <p className="text-2xl">🚫</p>
        <p className="font-bold text-slate-800">최고관리자(SUPER) 전용 화면입니다.</p>
      </div>
    );
  }

  return (
    <main className="space-y-5">
      <h1 className="text-xl font-bold text-slate-800">관리자 관리</h1>

      {createdPw && (
        <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4 space-y-1">
          <p className="font-bold text-emerald-800">✅ 관리자 생성 완료 — 초기 비밀번호(1회만 표시)</p>
          <p className="text-sm text-slate-700">이메일: <b>{createdPw.email}</b></p>
          <p className="text-sm text-slate-700">초기 비밀번호: <b className="font-mono text-base">{createdPw.password}</b></p>
          <p className="text-xs text-amber-700">※ 이 비밀번호는 지금만 보입니다. 본인에게 전달하고 첫 로그인 후 변경하도록 안내하세요.</p>
          <button onClick={() => setCreatedPw(null)} className="text-xs font-bold text-slate-500 underline mt-1">닫기</button>
        </div>
      )}

      <CreateAdmin
        onCreated={async (pw) => {
          setCreatedPw(pw);
          await load();
        }}
      />

      <div className="space-y-2">
        <h2 className="text-sm font-bold text-slate-700">관리자 목록 ({items.length})</h2>
        {loading ? (
          <p className="text-center text-slate-500 py-6">불러오는 중...</p>
        ) : (
          items.map((a) => <AdminRow key={a.id} admin={a} onChanged={load} />)
        )}
      </div>
    </main>
  );
}

function CreateAdmin({ onCreated }: { onCreated: (pw: { email: string; password: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [perms, setPerms] = useState<string[]>([...DEFAULT_PERMISSIONS]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const toggle = (key: string) =>
    setPerms((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  const submit = async () => {
    setErr('');
    if (!email.trim() || password.length < 8) {
      setErr('이메일과 8자 이상 비밀번호를 입력하세요.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, permissions: perms }),
      });
      const json = await res.json();
      if (!json.success) {
        setErr(json.message || '생성 실패');
        return;
      }
      onCreated({ email: json.data.email, password: json.data.initialPassword });
      setEmail('');
      setPassword('');
      setPerms([...DEFAULT_PERMISSIONS]);
      setOpen(false);
    } catch {
      setErr('네트워크 오류');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        + 관리자 추가
      </button>
    );
  }

  return (
    <div className="card space-y-3">
      <div className="flex justify-between items-center">
        <h2 className="font-bold text-slate-800">새 관리자 추가</h2>
        <button onClick={() => setOpen(false)} className="text-slate-400 text-xl leading-none">×</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input className="input-base" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input-base" type="text" placeholder="초기 비밀번호(8자 이상)" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div>
        <p className="label">권한 (기본 권한은 켜져 있음, 회수 가능)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
          {GRANTABLE.map((p) => (
            <label key={p.key} className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={perms.includes(p.key)} onChange={() => toggle(p.key)} />
              {p.label}
              {p.group === 'default' && <span className="text-[10px] text-emerald-600">기본</span>}
            </label>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-1">※ 운영 설정·관리자 관리는 최고관리자 전용이라 부여할 수 없습니다.</p>
      </div>
      {err && <div className="rounded bg-red-50 p-2 text-xs text-red-700">{err}</div>}
      <button onClick={submit} disabled={busy} className="btn-primary w-full">
        {busy ? '생성 중...' : '관리자 생성'}
      </button>
    </div>
  );
}

function AdminRow({ admin, onChanged }: { admin: AdminItem; onChanged: () => void }) {
  const isSuper = admin.role === 'SUPER';
  const [perms, setPerms] = useState<string[]>(admin.permissions);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // 서명 라벨(부서·이름·직책) — SUPER 대리 등록
  const [dept, setDept] = useState(admin.department);
  const [dispName, setDispName] = useState(admin.displayName);
  const [ttl, setTtl] = useState(admin.title);
  const labelDirty = dept !== admin.department || dispName !== admin.displayName || ttl !== admin.title;
  const labelPreview = [dept, dispName, ttl].map((s) => s.trim()).filter(Boolean).join(' ');

  const dirty = JSON.stringify([...perms].sort()) !== JSON.stringify([...admin.permissions].sort());

  const toggle = (key: string) =>
    setPerms((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  const patch = async (body: any, okMsg: string) => {
    setMsg('');
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/admins/${admin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) {
        setMsg(json.message || '실패');
        return;
      }
      setMsg(okMsg);
      onChanged();
    } catch {
      setMsg('네트워크 오류');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`card space-y-2 ${admin.isActive ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-slate-800 truncate">
            {admin.email}{' '}
            {isSuper ? (
              <span className="text-xs font-bold text-indigo-600">최고관리자</span>
            ) : (
              <span className="text-xs font-normal text-slate-500">관리자</span>
            )}
          </p>
          <p className="text-[11px] text-slate-400">
            {admin.isActive ? '활성' : '비활성'} · 등록 {admin.createdBy ?? '-'}
          </p>
        </div>
        <button
          onClick={() => patch({ isActive: !admin.isActive }, admin.isActive ? '비활성화됨' : '활성화됨')}
          disabled={busy}
          className={`text-xs font-bold ${admin.isActive ? 'text-red-600' : 'text-emerald-700'} hover:underline shrink-0`}
        >
          {admin.isActive ? '비활성화' : '활성화'}
        </button>
      </div>

      {/* 서명 라벨 대리 등록 — 포털 승인 계정 등 로그인 불가 계정도 SUPER가 여기서 등록 */}
      <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 space-y-2">
        <p className="text-[11px] font-bold text-slate-600">서명 라벨 (부서 · 이름 · 직책) — 출력·화면 표기용</p>
        <div className="grid grid-cols-3 gap-1.5">
          <input className="input-base text-sm" placeholder="부서" value={dept} onChange={(e) => setDept(e.target.value)} />
          <input className="input-base text-sm" placeholder="이름" value={dispName} onChange={(e) => setDispName(e.target.value)} />
          <input className="input-base text-sm" placeholder="직책" value={ttl} onChange={(e) => setTtl(e.target.value)} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-400 truncate">
            표시: {labelPreview ? <b className="text-slate-600">{labelPreview}</b> : <span className="italic">(정보 미등록)</span>}
          </p>
          {labelDirty && (
            <button
              onClick={() => patch({ displayName: dispName, title: ttl, department: dept }, '라벨 저장됨')}
              disabled={busy}
              className="btn-primary text-xs shrink-0 whitespace-nowrap"
            >{busy ? '저장 중...' : '라벨 저장'}</button>
          )}
        </div>
      </div>

      {isSuper ? (
        <p className="text-xs text-slate-500">전체 권한(SUPER) — 개별 권한 설정 없음</p>
      ) : (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {GRANTABLE.map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={perms.includes(p.key)} onChange={() => toggle(p.key)} />
                {p.label}
              </label>
            ))}
          </div>
          {dirty && (
            <button
              onClick={() => patch({ permissions: perms }, '권한 저장됨')}
              disabled={busy}
              className="btn-primary text-xs mt-2"
            >
              {busy ? '저장 중...' : '권한 저장'}
            </button>
          )}
        </div>
      )}

      {msg && <p className="text-[11px] text-slate-500">{msg}</p>}
    </div>
  );
}
