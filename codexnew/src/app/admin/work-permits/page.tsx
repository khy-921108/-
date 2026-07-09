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
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [unsignedOnly, setUnsignedOnly] = useState(false);

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
    router.push(`/admin/work-permits/${permitId}`);
  };

  const visibleItems = unsignedOnly
    ? items.filter((it) => (it.signature?.unsigned ?? 0) > 0)
    : items;

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
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={unsignedOnly}
            onChange={(e) => setUnsignedOnly(e.target.checked)}
            className="h-4 w-4"
          />
          ⚠️ 서명 미완료만 보기
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setKeyword('');
              setDateFrom('');
              setDateTo('');
              setUnsignedOnly(false);
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
        <p className="text-xs text-slate-500">
          총 {visibleItems.length}건{unsignedOnly ? ` (서명 미완료만 · 전체 ${items.length}건)` : ''} · 카드를 누르면 상세/인쇄로 이동
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
        {visibleItems.length === 0 && !loading && (
          <div className="card text-center text-slate-500 py-8">
            {unsignedOnly && items.length > 0 ? '서명 미완료 신청이 없습니다.' : '신청 내역이 없습니다.'}
          </div>
        )}
      </div>
    </main>
  );
}
