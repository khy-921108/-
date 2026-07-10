'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SUPPLEMENTAL_WORKS } from '@/lib/work-permit-constants';
import { STAGE_BADGE_CLASS, type Stage } from '@/lib/work-permit-stage';

interface Item {
  permitId: string;
  permitNumber: string;
  workName: string;
  workStart: string;
  workEnd: string;
  companyName: string;
  supplemental: Record<string, 'Y' | 'N'>;
  status: string;
  stage?: Stage;
  createdAt: string;
  issued: boolean;
}

function fmtDateTime(iso: string): string {
  if (!iso) return '-';
  const k = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

const PAGE_SIZE = 5;

export default function MyWorkPermits() {
  const router = useRouter();

  // 조회 월 (YYYY-MM) — 기본=이번 달, ◀ 6개월 전까지 / ▶ 다음 달까지
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const thisMonth = ymOf(new Date());
  const minMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 6); return ymOf(d); })();
  const maxMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return ymOf(d); })();
  const shiftMonth = (ym: string, delta: number) => { const [y, m] = ym.split('-').map(Number); return ymOf(new Date(y, m - 1 + delta, 1)); };

  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [month, setMonth] = useState(thisMonth);
  const [items, setItems] = useState<Item[] | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const formatPhone = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 11);

  const search = async (m = month) => {
    setError('');
    if (!name.trim() || !birthDate || phone.length < 10) {
      setError('이름·생년월일·연락처를 정확히 입력해 주세요.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/work-permits/my-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, birthDate, phone, month: m }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message || '조회에 실패했습니다.');
        setItems(null);
        return;
      }
      setItems(json.data.items);
      setPage(1);
    } catch (e) {
      console.error(e);
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 월 이동 — 이미 조회한 상태면 새 달로 자동 재조회
  const changeMonth = (delta: number) => {
    const nm = shiftMonth(month, delta);
    if (nm < minMonth || nm > maxMonth) return;
    setMonth(nm);
    setPage(1);
    if (items !== null) search(nm);
  };

  const suppLabels = (s: Record<string, 'Y' | 'N'>) =>
    SUPPLEMENTAL_WORKS.filter((w) => s?.[w.key] === 'Y').map((w) => w.label);

  // 현장 TBM 화면으로 이동 — 본인확인 정보를 sessionStorage로 전달(재입력 방지)
  const goTbm = (permitId: string) => {
    try {
      sessionStorage.setItem('wp_tbm_cred', JSON.stringify({ name, birthDate, phone }));
    } catch { /* */ }
    router.push(`/work-permit/tbm/${permitId}`);
  };

  const [my, mm] = month.split('-');
  const totalPages = Math.max(1, Math.ceil((items?.length ?? 0) / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const visible = (items ?? []).slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">내 작업허가 신청내역</h1>
        <p className="mt-1 text-sm text-slate-500">
          신청 시 입력한 <b>이름·생년월일·연락처</b>로 본인이 신청한 허가서를 조회합니다.
        </p>
      </header>

      <div className="card space-y-3">
        <div>
          <label className="label">성명</label>
          <input className="input-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
        </div>
        <div>
          <label className="label">생년월일</label>
          <input type="date" className="input-base" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </div>
        <div>
          <label className="label">연락처 (숫자만)</label>
          <input
            type="tel"
            inputMode="numeric"
            className="input-base"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            placeholder="01012345678"
          />
        </div>

        {/* 조회 월 선택기 (◀ 6개월 전 ~ ▶ 다음 달) */}
        <div>
          <label className="label">조회 월</label>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => changeMonth(-1)}
              disabled={month <= minMonth}
              className="h-9 w-9 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-30 text-lg leading-none"
              aria-label="이전 달"
            >◀</button>
            <span className="text-base font-bold text-slate-800 w-32 text-center">{my}년 {Number(mm)}월</span>
            <button
              onClick={() => changeMonth(1)}
              disabled={month >= maxMonth}
              className="h-9 w-9 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-30 text-lg leading-none"
              aria-label="다음 달"
            >▶</button>
          </div>
          <p className="mt-1 text-xs text-slate-500 text-center">※ 선택한 달에 작업예정인 허가서를 조회 (최근 6개월 ~ 다음 달)</p>
        </div>

        {error && <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <button onClick={() => search(month)} disabled={loading} className="btn-primary">
          {loading ? '조회 중...' : '조회'}
        </button>
      </div>

      {items !== null && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-700">
            {my}년 {Number(mm)}월 · 총 {items.length}건
          </p>
          {visible.map((it) => {
            const supp = suppLabels(it.supplemental);
            return (
              <div
                key={it.permitId}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/work-permit/print/${it.permitId}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') router.push(`/work-permit/print/${it.permitId}`);
                }}
                className="card space-y-2 cursor-pointer hover:shadow-md transition"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm font-bold text-brand">{it.permitNumber}</p>
                      {it.stage && <span className={`rounded-full text-[11px] font-bold px-2 py-0.5 ${STAGE_BADGE_CLASS[it.stage.key]}`}>{it.stage.label}</span>}
                    </div>
                    <p className="font-bold text-slate-800 mt-0.5 hover:underline">{it.workName}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{it.companyName}</p>
                    <p className="text-xs text-slate-600 mt-0.5">📅 {fmtDateTime(it.workStart)} ~ {fmtDateTime(it.workEnd)}</p>
                    {supp.length > 0 && (
                      <p className="text-xs text-amber-700 mt-0.5">보충: {supp.join(', ')}</p>
                    )}
                  </div>
                  <span className="text-slate-300 text-lg shrink-0">›</span>
                </div>
                {it.issued && (
                  <button
                    onClick={(e) => { e.stopPropagation(); goTbm(it.permitId); }}
                    className="w-full rounded-lg bg-emerald-600 text-white text-sm font-bold py-2 hover:bg-emerald-700"
                  >
                    🦺 현장 TBM 진행 (사진·작업자 서명)
                  </button>
                )}
                <div className="flex gap-3 pt-2 border-t border-slate-100">
                  <a
                    href={`/work-permit/print/${it.permitId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs font-bold text-brand hover:underline"
                  >
                    🖨 인쇄/상세
                  </a>
                  <a
                    href={`/api/work-permits/${it.permitId}/xlsx`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs font-bold text-slate-600 hover:underline"
                  >
                    📥 양식 .xlsx
                  </a>
                </div>
              </div>
            );
          })}
          {items.length === 0 && (
            <div className="card text-center text-slate-500 py-8">
              {my}년 {Number(mm)}월에 조회된 신청내역이 없습니다.<br />
              <span className="text-xs">다른 달을 선택하거나, 신청 시 입력한 이름·생년월일·연락처와 동일한지 확인해 주세요.</span>
            </div>
          )}

          {/* 페이지네이션 (5개씩) */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={curPage <= 1}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 disabled:opacity-30">이전</button>
              <span className="text-sm font-semibold text-slate-700">{curPage} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={curPage >= totalPages}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 disabled:opacity-30">다음</button>
            </div>
          )}
        </div>
      )}

      <button onClick={() => router.push('/work-permit')} className="btn-secondary">
        새 작업허가 신청
      </button>
    </main>
  );
}
