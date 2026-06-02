'use client';

import { useEffect, useState } from 'react';
import { formatDate } from '@/lib/format';
import { SUPPLEMENTAL_WORKS } from '@/lib/work-permit-constants';

interface Item {
  permitId: string;
  permitNumber: string;
  permitType: string;
  companyName: string;
  workName: string;
  applicantName: string;
  participantCount: number;
  supplemental: Record<string, 'Y' | 'N'>;
  status: string;
  createdAt: string;
}

export default function AdminWorkPermitsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (keyword) params.set('keyword', keyword);
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
        <button onClick={load} className="btn-primary">{loading ? '조회 중...' : '조회'}</button>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-slate-500">총 {items.length}건</p>
        {items.map((it) => {
          const supp = suppLabels(it.supplemental);
          return (
            <div key={it.permitId} className="card space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-mono text-sm font-bold text-brand">{it.permitNumber}</p>
                  <p className="font-bold text-slate-800 mt-0.5">{it.workName}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{it.companyName} · 신청인 {it.applicantName} · 참여자 {it.participantCount}명</p>
                  {supp.length > 0 && (
                    <p className="text-xs text-amber-700 mt-0.5">보충: {supp.join(', ')}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-0.5">신청일 {formatDate(it.createdAt)}</p>
                </div>
              </div>
              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <a href={`/work-permit/print/${it.permitId}`} target="_blank" rel="noreferrer" className="text-xs font-bold text-brand hover:underline">🖨 인쇄/상세</a>
                <a href={`/api/work-permits/${it.permitId}/xlsx`} className="text-xs font-bold text-slate-600 hover:underline">📥 양식 .xlsx</a>
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
