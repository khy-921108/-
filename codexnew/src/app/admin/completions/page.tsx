'use client';

import { useEffect, useState } from 'react';

interface Item {
  sessionId: string;
  name: string;
  affiliation: string;
  phone: string;
  birthDate: string;
  targetType: string;
  targetLabel: string;
  status: string;
  createdAt: string;
  completionNumber: string | null;
  completedAt: string | null;
  validUntil: string | null;
  score: number | null;
}

const STATUSES = [
  { code: '', label: '전체' },
  { code: 'VALID', label: '유효 수료' },
  { code: 'EXPIRED', label: '만료' },
  { code: 'IN_PROGRESS', label: '진행중' },
  { code: 'FAILED', label: '불합격' },
];

const TARGETS = [
  { code: '', label: '전체' },
  { code: 'TRUCK', label: '화물차' },
  { code: 'WORKER', label: '작업자' },
  { code: 'HEAVY', label: '중장비' },
];

function formatDate(iso: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    VALID: 'bg-emerald-100 text-emerald-700',
    EXPIRED: 'bg-red-100 text-red-700',
    IN_PROGRESS: 'bg-blue-100 text-blue-700',
    FAILED: 'bg-amber-100 text-amber-700',
    COMPLETED: 'bg-emerald-100 text-emerald-700',
  };
  const label: Record<string, string> = {
    VALID: '유효',
    EXPIRED: '만료',
    IN_PROGRESS: '진행중',
    FAILED: '불합격',
    COMPLETED: '수료',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${map[status] ?? 'bg-slate-100'}`}>
      {label[status] ?? status}
    </span>
  );
}

export default function AdminCompletionsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [targetType, setTargetType] = useState('');
  const [keyword, setKeyword] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (targetType) params.set('targetType', targetType);
    if (keyword) params.set('keyword', keyword);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    const res = await fetch(`/api/admin/completions?${params.toString()}`);
    const json = await res.json();
    if (json.success) setItems(json.data.items);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">수료 현황</h1>

      <div className="card space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <select
            className="input-base"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s.code} value={s.code}>
                상태: {s.label}
              </option>
            ))}
          </select>
          <select
            className="input-base"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
          >
            {TARGETS.map((t) => (
              <option key={t.code} value={t.code}>
                대상: {t.label}
              </option>
            ))}
          </select>
        </div>
        <input
          className="input-base"
          placeholder="이름 또는 소속 검색"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            className="input-base"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <input
            type="date"
            className="input-base"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <button onClick={load} className="btn-primary">
          {loading ? '조회 중...' : '조회'}
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-slate-500">총 {items.length}건</p>
        {items.map((it) => (
          <div key={it.sessionId} className="card space-y-2">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-bold text-slate-800">
                  {it.name} <span className="font-normal text-slate-500">({it.affiliation})</span>
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {it.targetLabel} · {it.phone}
                </p>
              </div>
              {statusBadge(it.status)}
            </div>
            <div className="text-xs text-slate-600 grid grid-cols-2 gap-1">
              <span>응시일: {formatDate(it.createdAt)}</span>
              <span>수료일: {formatDate(it.completedAt)}</span>
              <span>유효기간: {formatDate(it.validUntil)}</span>
              {it.completionNumber && (
                <span className="font-mono col-span-2">#{it.completionNumber}</span>
              )}
            </div>
          </div>
        ))}
        {items.length === 0 && !loading && (
          <div className="card text-center text-slate-500 py-8">조회 결과가 없습니다.</div>
        )}
      </div>
    </main>
  );
}
