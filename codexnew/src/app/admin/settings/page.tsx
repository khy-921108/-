'use client';

/**
 * 관리자 개인 설정 — 이름·직책·부서 (표기용).
 * B안: 서명은 승인 시 매번 손서명. 등록 서명(도장) 방식 폐지 → 서명 저장란 없음.
 * (admins.signature 컬럼은 미사용으로 방치)
 */

import { useEffect, useState } from 'react';

export default function AdminSettingsPage() {
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    try {
      const res = await fetch('/api/admin/me', { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setEmail(json.data.email ?? '');
        setDepartment(json.data.department ?? '');
        setDisplayName(json.data.displayName ?? '');
        setTitle(json.data.title ?? '');
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      const res = await fetch('/api/admin/me', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ department, displayName, title }),
      });
      const json = await res.json();
      setMsg(json.success ? '저장되었습니다.' : (json.message || '저장 실패'));
      if (json.success) await load();
    } catch {
      setMsg('네트워크 오류');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-10 text-center text-slate-500">불러오는 중…</div>;

  const preview = `${department} ${displayName} ${title}`.trim() || '(미입력)';

  return (
    <main className="space-y-5 max-w-lg">
      <h1 className="text-xl font-bold text-slate-800">내 정보 설정</h1>
      <p className="text-sm text-slate-500">
        여기서 등록한 부서·이름·직책이 허가서·엑셀에 <b>{preview}</b> 로 표기됩니다. ({email})
        <br />※ 승인 서명은 승인할 때마다 직접 손서명합니다(등록 도장 없음).
      </p>

      <section className="card space-y-3 text-sm">
        <div>
          <label className="label">부서/소속</label>
          <input className="input-base" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="예: 안전환경" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">이름</label>
            <input className="input-base" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="예: 김형준" />
          </div>
          <div>
            <label className="label">직책</label>
            <input className="input-base" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 대리" />
          </div>
        </div>
        <p className="text-xs text-slate-500">표기 미리보기: <b>{preview}</b></p>
      </section>

      {msg && <div className="card bg-slate-50 text-sm text-slate-700">{msg}</div>}

      <button onClick={save} disabled={saving} className="btn-primary w-full">{saving ? '저장 중…' : '저장'}</button>
    </main>
  );
}
