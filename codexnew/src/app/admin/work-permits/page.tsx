'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/lib/format';
import { SUPPLEMENTAL_WORKS } from '@/lib/work-permit-constants';
import { STAGE_BADGE_CLASS, type Stage } from '@/lib/work-permit-stage';

interface SigStatus {
  total: number;
  signed: number;
  unsigned: number;
  unsignedNames: string[];
  participants: { name: string; signed: boolean }[];
}

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
  stage?: Stage;
  approvedBy?: string | null;
  approvedAt?: string | null;
  createdAt: string;
  signature?: SigStatus;
}

/** R-6 진행단계 뱃지 (서버 계산 stage 기반 — status 컬럼 오염 방지) */
function StageBadge({ stage, by, at }: { stage?: Stage; by?: string | null; at?: string | null }) {
  if (!stage) return null;
  const tip = (stage.key === 'STARTED' || stage.key === 'REJECTED' || stage.key === 'CLOSED') && by
    ? `${by}${at ? ' · ' + fmtDateTime(at) : ''}`
    : undefined;
  return (
    <span title={tip} className={`rounded-full text-xs font-bold px-2 py-0.5 whitespace-nowrap ${STAGE_BADGE_CLASS[stage.key]}`}>
      {stage.label}
    </span>
  );
}

function fmtDateTime(iso: string): string {
  if (!iso) return '-';
  const k = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

export default function AdminWorkPermitsPage() {
  const router = useRouter();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const thisMonth = ymOf(new Date());
  const maxMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return ymOf(d); })(); // 다음 달까지
  const shiftMonth = (ym: string, delta: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); return ymOf(d); };
  const PAGE_SIZE = 10;

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [month, setMonth] = useState(thisMonth);
  const [unsignedOnly, setUnsignedOnly] = useState(false);
  const [page, setPage] = useState(1);

  const load = async (m = month, kw = keyword) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (kw) params.set('keyword', kw);
      if (m) params.set('month', m);
      const res = await fetch(`/api/admin/work-permits?${params.toString()}`);
      const json = await res.json();
      if (json.success) setItems(json.data.items);
      else alert(json.message || '조회 실패');
    } finally {
      setLoading(false);
    }
  };

  // 진입/월 변경 시 자동 조회 (조회 버튼 없이)
  useEffect(() => {
    setPage(1);
    load(month, keyword);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const suppLabels = (s: Record<string, 'Y' | 'N'>) =>
    SUPPLEMENTAL_WORKS.filter((w) => s?.[w.key] === 'Y').map((w) => w.label);

  const openDetail = (permitId: string) => {
    router.push(`/admin/work-permits/${permitId}`);
  };

  const filtered = unsignedOnly ? items.filter((it) => (it.signature?.unsigned ?? 0) > 0) : items;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const visibleItems = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const [my, mm] = month.split('-');

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">작업허가 신청 목록</h1>

      <div className="card space-y-3">
        {/* 조회 월 선택기 */}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            className="h-9 w-9 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-lg leading-none"
            aria-label="이전 달"
          >◀</button>
          <span className="text-base font-bold text-slate-800 w-32 text-center">{my}년 {Number(mm)}월</span>
          <button
            onClick={() => setMonth((m) => (m < maxMonth ? shiftMonth(m, 1) : m))}
            disabled={month >= maxMonth}
            className="h-9 w-9 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-30 text-lg leading-none"
            aria-label="다음 달"
          >▶</button>
        </div>

        {/* 통합 검색 (선택 월 안에서) */}
        <div className="flex gap-2 items-stretch">
          <input
            className="input-base flex-1 min-w-0"
            placeholder="신청번호·업체·작업명·신청인 검색"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); load(month, keyword); } }}
          />
          <button
            onClick={() => { setPage(1); load(month, keyword); }}
            className="shrink-0 rounded-xl bg-brand text-white text-sm font-semibold px-5 whitespace-nowrap disabled:opacity-50"
            disabled={loading}
          >{loading ? '조회 중…' : '검색'}</button>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
            <input type="checkbox" checked={unsignedOnly} onChange={(e) => { setUnsignedOnly(e.target.checked); setPage(1); }} className="h-4 w-4" />
            ⚠️ 서명 미완료만 보기
          </label>
          <button
            onClick={() => { setKeyword(''); setUnsignedOnly(false); setMonth(thisMonth); setPage(1); if (month === thisMonth) load(thisMonth, ''); }}
            className="text-xs text-slate-500 underline"
          >이번 달로 초기화</button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-700">
          {my}년 {Number(mm)}월 · 총 {filtered.length}건{unsignedOnly ? ' (서명 미완료만)' : ''}
        </p>
        {visibleItems.map((it) => {
          const supp = suppLabels(it.supplemental);
          const sig = it.signature;
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
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <StageBadge stage={it.stage} by={it.approvedBy} at={it.approvedAt} />
                  {sig && sig.total > 0 && (
                    sig.unsigned === 0 ? (
                      <span className="rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 whitespace-nowrap">
                        ✅ 서명완료 {sig.signed}/{sig.total}
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5 whitespace-nowrap">
                        ⚠️ 미완료 {sig.unsigned}명
                      </span>
                    )
                  )}
                  <span className="text-slate-300 text-lg">›</span>
                </div>
              </div>

              {sig && sig.participants.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                  <span className="text-[11px] text-slate-400 mr-1">개인서약 서명:</span>
                  {sig.participants.map((pp, i) => (
                    <span
                      key={`${pp.name}-${i}`}
                      className={
                        'text-[11px] rounded px-1.5 py-0.5 ' +
                        (pp.signed
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-800 font-bold ring-1 ring-amber-300')
                      }
                    >
                      {pp.signed ? '✓' : '✗'} {pp.name || '(이름없음)'}
                    </span>
                  ))}
                </div>
              )}
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
        {filtered.length === 0 && !loading && (
          <div className="card text-center text-slate-500 py-8">
            {unsignedOnly && items.length > 0 ? '서명 미완료 신청이 없습니다.' : `${my}년 ${Number(mm)}월에 해당하는 작업허가가 없습니다.`}
          </div>
        )}

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1 pt-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={curPage <= 1}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 disabled:opacity-30">이전</button>
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} onClick={() => setPage(i + 1)}
                className={`h-8 w-8 rounded-lg text-sm font-semibold ${curPage === i + 1 ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{i + 1}</button>
            ))}
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={curPage >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 disabled:opacity-30">다음</button>
          </div>
        )}
      </div>
    </main>
  );
}
