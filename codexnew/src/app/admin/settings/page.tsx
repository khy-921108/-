'use client';

/**
 * 관리자 개인 설정 — 이름·직책·부서 (표기용).
 * B안: 서명은 승인 시 매번 손서명. 등록 서명(도장) 방식 폐지 → 서명 저장란 없음.
 * (admins.signature 컬럼은 미사용으로 방치)
 */

import { useEffect, useState } from 'react';

export default function AdminSettingsPage() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [department, setDepartment] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // 전체 백업 안내 문구(SUPER 수정)
  const [guide, setGuide] = useState('');
  const [guideBusy, setGuideBusy] = useState(false);
  const [guideMsg, setGuideMsg] = useState('');

  const load = async () => {
    try {
      const res = await fetch('/api/admin/me', { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setEmail(json.data.email ?? '');
        setRole(json.data.role ?? '');
        setDepartment(json.data.department ?? '');
        setDisplayName(json.data.displayName ?? '');
        setTitle(json.data.title ?? '');
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    fetch('/api/admin/backup-guide', { cache: 'no-store' })
      .then((r) => r.json()).then((j) => { if (j.success) setGuide(j.data.guide); }).catch(() => {});
  }, []);

  const saveGuide = async () => {
    setGuideBusy(true); setGuideMsg('');
    try {
      const res = await fetch('/api/admin/backup-guide', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guide }),
      });
      const j = await res.json();
      setGuideMsg(j.success ? '안내 문구 저장됨' : (j.message || '저장 실패'));
    } catch { setGuideMsg('네트워크 오류'); } finally { setGuideBusy(false); }
  };

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

      {/* 전체 백업 — 최고관리자 전용 (개인정보 전체 포함) */}
      {role === 'SUPER' && (
        <section className="card space-y-3 border-2 border-slate-300">
          <h2 className="font-bold text-slate-800">📦 전체 백업 다운로드 <span className="text-xs font-normal text-slate-500">(최고관리자 전용)</span></h2>
          <p className="text-xs text-slate-500">산업안전보건법 <b>서류 3년 보존</b> 대응. Supabase 무료 플랜은 자동 백업이 없어 이 백업이 실질 보존 수단입니다.</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <a href="/api/admin/backup/data" className="flex-1 text-center rounded-xl bg-brand text-white px-5 py-4 text-base font-bold shadow active:scale-95">📄 데이터 백업</a>
            <a href="/api/admin/backup/photos" className="flex-1 text-center rounded-xl bg-slate-700 text-white px-5 py-4 text-base font-bold shadow active:scale-95">🖼 사진 백업</a>
          </div>
          <p className="text-[11px] text-slate-400">※ 데이터(수료·업체·허가서·서약·각서 · 엑셀+JSON)와 TBM 현장사진을 나눠 받습니다. 생성에 수십 초 걸릴 수 있어요.</p>

          <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 space-y-2">
            <p className="text-xs font-bold text-amber-800">보관 안내 문구 (버튼 옆 표시 — 수정 가능)</p>
            <textarea className="input-base text-sm min-h-[60px]" maxLength={200} value={guide} onChange={(e) => setGuide(e.target.value)} />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-400">{guideMsg}</span>
              <button onClick={saveGuide} disabled={guideBusy} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-brand text-white disabled:opacity-50">{guideBusy ? '저장 중…' : '안내문구 저장'}</button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
