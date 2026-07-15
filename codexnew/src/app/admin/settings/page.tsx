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

  // 홈 공지(SUPER)
  const [notice, setNotice] = useState('');
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [noticeMsg, setNoticeMsg] = useState('');

  // 백업 조회 월 (YYYY-MM) — 기본 이번 달, 과거 무제한, 미래는 이번 달까지
  const _pad = (n: number) => String(n).padStart(2, '0');
  const _ym = (d: Date) => `${d.getFullYear()}-${_pad(d.getMonth() + 1)}`;
  const thisMonth = _ym(new Date());
  const [bmonth, setBmonth] = useState(thisMonth);
  const shiftM = (ym: string, delta: number) => { const [y, m] = ym.split('-').map(Number); return _ym(new Date(y, m - 1 + delta, 1)); };
  const [by, bm] = bmonth.split('-');

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
  useEffect(() => {
    fetch('/api/admin/home-notice', { cache: 'no-store' })
      .then((r) => r.json()).then((j) => { if (j.success) setNotice(j.data.notice ?? ''); }).catch(() => {});
  }, []);

  const saveNotice = async (body: string) => {
    setNoticeBusy(true); setNoticeMsg('');
    try {
      const res = await fetch('/api/admin/home-notice', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notice: body }),
      });
      const j = await res.json();
      if (j.success) { setNotice(j.data.notice ?? ''); setNoticeMsg(body.trim() ? '공지 저장됨' : '공지를 내렸습니다.'); }
      else setNoticeMsg(j.message || '저장 실패');
    } catch { setNoticeMsg('네트워크 오류'); } finally { setNoticeBusy(false); }
  };

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

      {/* 홈 공지 — 최고관리자 전용 */}
      {role === 'SUPER' && (
        <section className="card space-y-3 border-2 border-amber-200">
          <h2 className="font-bold text-slate-800">📢 홈 공지 <span className="text-xs font-normal text-slate-500">(최고관리자 전용)</span></h2>
          <p className="text-xs text-slate-500">홈 화면 맨 위에 배너로 표시됩니다. 비우고 저장하면 공지가 내려갑니다. (최대 200자)</p>
          <textarea
            className="input-base text-sm min-h-[80px]"
            maxLength={200}
            value={notice}
            onChange={(e) => setNotice(e.target.value)}
            placeholder="예: 7/20(월) 정기 안전점검으로 오전 출입이 제한됩니다."
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400">{noticeMsg}</span>
            <div className="flex gap-2">
              <button onClick={() => saveNotice('')} disabled={noticeBusy} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 disabled:opacity-50">공지 내리기</button>
              <button onClick={() => saveNotice(notice)} disabled={noticeBusy} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-brand text-white disabled:opacity-50">{noticeBusy ? '저장 중…' : '저장'}</button>
            </div>
          </div>
        </section>
      )}

      {/* 전체 백업 — 최고관리자 전용 (개인정보 전체 포함) */}
      {role === 'SUPER' && (
        <section className="card space-y-3 border-2 border-slate-300">
          <h2 className="font-bold text-slate-800">📦 전체 백업 다운로드 <span className="text-xs font-normal text-slate-500">(최고관리자 전용)</span></h2>
          <p className="text-xs text-slate-500">산업안전보건법 <b>서류 3년 보존</b> 대응. Supabase 무료 플랜은 자동 백업이 없어 이 백업이 실질 보존 수단입니다. <b>매월 그 달치</b>를 받아 NAS에 보관하세요.</p>

          {/* 조회 월 선택기 */}
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => setBmonth((m) => shiftM(m, -1))} className="h-9 w-9 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-lg leading-none" aria-label="이전 달">◀</button>
            <span className="text-base font-bold text-slate-800 w-32 text-center">{by}년 {Number(bm)}월</span>
            <button onClick={() => setBmonth((m) => (m < thisMonth ? shiftM(m, 1) : m))} disabled={bmonth >= thisMonth} className="h-9 w-9 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-30 text-lg leading-none" aria-label="다음 달">▶</button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <a href={`/api/admin/backup/data?month=${bmonth}`} className="flex-1 text-center rounded-xl bg-brand text-white px-5 py-4 text-base font-bold shadow active:scale-95">📄 이 달 데이터 백업</a>
            <a href={`/api/admin/backup/photos?month=${bmonth}`} className="flex-1 text-center rounded-xl bg-slate-700 text-white px-5 py-4 text-base font-bold shadow active:scale-95">🖼 이 달 사진 백업</a>
          </div>
          <p className="text-[11px] text-slate-400">※ 데이터 zip엔 <b>허가서양식/</b> 폴더에 그 달 허가서가 회사양식 xlsx로 건별 들어갑니다(+수료·업체·서약·각서 JSON·엑셀). 생성에 수십 초 걸릴 수 있어요.</p>

          {/* 많을 때: 반기 분할 다운로드(기본 접힘) */}
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-bold text-slate-500 select-none">건수가 많아 시간이 오래 걸리면 — 반기 분할 다운로드</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <a href={`/api/admin/backup/data?month=${bmonth}&half=H1`} className="text-center rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">📄 전반기(1~15일) 데이터</a>
              <a href={`/api/admin/backup/data?month=${bmonth}&half=H2`} className="text-center rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">📄 후반기(16~말일) 데이터</a>
              <a href={`/api/admin/backup/photos?month=${bmonth}&half=H1`} className="text-center rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">🖼 전반기 사진</a>
              <a href={`/api/admin/backup/photos?month=${bmonth}&half=H2`} className="text-center rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">🖼 후반기 사진</a>
            </div>
          </details>

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
