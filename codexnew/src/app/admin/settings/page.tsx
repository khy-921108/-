'use client';

/**
 * 관리자 개인 설정 — R-6 게이트③-4: 내 서명 등록(부서·이름·직책 + 서명 이미지).
 * 등록해두면 작업허가 승인 서명 시 [등록 서명 사용]으로 1클릭 자동 채움.
 */

import { useEffect, useState } from 'react';
import SignaturePad from '@/components/SignaturePad';

export default function AdminSettingsPage() {
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [title, setTitle] = useState('');
  const [savedSig, setSavedSig] = useState<string | null>(null); // 기존 등록 서명
  const [newSig, setNewSig] = useState(''); // 새로 그린 서명
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
        setSavedSig(json.data.signature ?? null);
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true); setMsg('');
    try {
      const body: any = { department, displayName, title };
      if (newSig) body.signature = newSig; // 새로 그렸을 때만 서명 갱신
      const res = await fetch('/api/admin/me', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) { setMsg(json.message || '저장 실패'); return; }
      setMsg('저장되었습니다.');
      setNewSig('');
      await load();
    } catch {
      setMsg('네트워크 오류');
    } finally {
      setSaving(false);
    }
  };

  const clearSig = async () => {
    if (!confirm('등록된 서명을 삭제할까요?')) return;
    setSaving(true); setMsg('');
    try {
      const res = await fetch('/api/admin/me', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ department, displayName, title, signature: null }),
      });
      const json = await res.json();
      if (json.success) { setMsg('서명을 삭제했습니다.'); await load(); }
      else setMsg(json.message || '삭제 실패');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-10 text-center text-slate-500">불러오는 중…</div>;

  const preview = `${department} ${displayName} ${title}`.trim() || '(미입력)';

  return (
    <main className="space-y-5 max-w-lg">
      <h1 className="text-xl font-bold text-slate-800">내 서명 설정</h1>
      <p className="text-sm text-slate-500">
        여기서 등록한 서명·직책은 작업허가 승인 시 <b>[등록 서명 사용]</b>으로 1클릭 삽입되고,
        허가서·엑셀에 <b>{preview}</b> 로 표기됩니다. ({email})
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

      <section className="card space-y-2">
        <p className="text-sm font-bold text-slate-700">등록 서명</p>
        {savedSig && !newSig && (
          <div className="flex items-center gap-3">
            <img src={savedSig} alt="등록 서명" className="h-12 border border-slate-200 rounded bg-white px-1" />
            <span className="text-xs text-emerald-600 font-medium">현재 등록됨</span>
            <button onClick={clearSig} disabled={saving} className="text-xs text-red-500 underline ml-auto">서명 삭제</button>
          </div>
        )}
        <p className="text-xs text-slate-500">{savedSig ? '아래에 다시 그리면 새 서명으로 교체됩니다.' : '아래에 서명을 그려 등록하세요.'}</p>
        <SignaturePad onChange={setNewSig} />
      </section>

      {msg && <div className="card bg-slate-50 text-sm text-slate-700">{msg}</div>}

      <button onClick={save} disabled={saving} className="btn-primary w-full">{saving ? '저장 중…' : '저장'}</button>
    </main>
  );
}
