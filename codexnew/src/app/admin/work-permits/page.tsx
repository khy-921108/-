'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/format';
import { SUPPLEMENTAL_WORKS } from '@/lib/work-permit-constants';

interface Item {
  permitId: string;
  permitNumber: string;
  permitType: string;
  companyName: string;
  workName: string;
  workStart: string;
  workEnd: string;
  applicantName: string;
  participantCount: number;
  supplemental: Record<string, 'Y' | 'N'>;
  status: string;
  createdAt: string;
}

function fmtDateTime(iso: string): string {
  if (!iso) return '-';
  const k = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

export default function AdminWorkPermitsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (keyword) params.set('keyword', keyword);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const res = await fetch(`/api/admin/work-permits?${params.toString()}`);
      const json = await res.json();
      if (json.success) setItems(json.data.items);
      else alert(json.message || '조회 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suppLabels = (s: Record<string, 'Y' | 'N'>) =>
    SUPPLEMENTAL_WORKS.filter((w) => s?.[w.key] === 'Y').map((w) => w.label);

  const openDetail = (permitId: string) => {
    router.push(`/work-permit/print/${permitId}`);
  };

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">작업허가 신청 목록</h1>

      <div className="card space-y-3">
        <input
          className="input-base"
          placeholder="신청번호·업체·작업명·신청인 검색"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div>
          <label className="label">작업예정일 (작업 시작일 기준)</label>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              className="input-base"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="작업예정일 시작"
            />
            <input
              type="date"
              className="input-base"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="작업예정일 종료"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setKeyword('');
              setDateFrom('');
              setDateTo('');
              setTimeout(load, 0);
            }}
            className="btn-secondary"
          >
            초기화
          </button>
          <button onClick={load} className="btn-primary">{loading ? '조회 중...' : '조회'}</button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-slate-500">총 {items.length}건 · 카드를 누르면 상세/인쇄로 이동</p>
        {items.map((it) => {
          const supp = suppLabels(it.supplemental);
          return (
            <div
              key={it.permitId}
              role="button"
              tabIndex={0}
              onClick={() => openDetail(it.permitId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') openDetail(it.permitId);
              }}
              className="card space-y-2 cursor-pointer hover:shadow-md transition"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-mono text-sm font-bold text-brand">{it.permitNumber}</p>
                  <p className="font-bold text-slate-800 mt-0.5 hover:underline">{it.workName}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{it.companyName} · 신청인 {it.applicantName} · 참여자 {it.participantCount}명</p>
                  <p className="text-xs text-slate-600 mt-0.5">📅 작업예정 {fmtDateTime(it.workStart)} ~ {fmtDateTime(it.workEnd)}</p>
                  {supp.length > 0 && (
                    <p className="text-xs text-amber-700 mt-0.5">보충: {supp.join(', ')}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-0.5">신청일 {formatDate(it.createdAt)}</p>
                </div>
                <span className="text-slate-300 text-lg shrink-0">›</span>
              </div>
              <div className="flex gap-3 pt-2 border-t border-slate-100">
                <a
                  href={`/work-permit/print/${it.permitId}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs font-bold text-brand hover:underline"
                >
                  🖨 새 탭으로 인쇄
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
        {items.length === 0 && !loading && (
          <div className="card text-center text-slate-500 py-8">신청 내역이 없습니다.</div>
        )}
      </div>
    </main>
  );
}
