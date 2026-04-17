'use client';

import { useEffect, useState } from 'react';
import { formatDate } from '@/lib/format';

interface Item {
  sessionId: string;
  name: string;
  affiliation: string;
  phone: string;
  birthDate: string;
  vehicleNumber: string | null;
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
  const [selected, setSelected] = useState<Item | null>(null);

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

  // ESC 키로 모달 닫기
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, []);

  const handlePrint = () => {
    window.print();
  };

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800 no-print">수료 현황</h1>

      <div className="card space-y-3 no-print">
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

      <div className="space-y-2 no-print">
        <p className="text-xs text-slate-500">총 {items.length}건 · 카드 클릭 시 상세 보기</p>
        {items.map((it) => (
          <button
            type="button"
            key={it.sessionId}
            onClick={() => setSelected(it)}
            className="card space-y-2 w-full text-left hover:shadow-md transition"
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="font-bold text-slate-800">
                  {it.name} <span className="font-normal text-slate-500">({it.affiliation})</span>
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {it.targetLabel} · {it.phone}
                </p>
                {it.vehicleNumber && (
                  <p className="text-xs font-mono text-slate-700 mt-0.5">
                    🚗 {it.vehicleNumber}
                  </p>
                )}
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
          </button>
        ))}
        {items.length === 0 && !loading && (
          <div className="card text-center text-slate-500 py-8">조회 결과가 없습니다.</div>
        )}
      </div>

      {selected && (
        <DetailModal
          item={selected}
          onClose={() => setSelected(null)}
          onPrint={handlePrint}
        />
      )}
    </main>
  );
}

function DetailModal({
  item,
  onClose,
  onPrint,
}: {
  item: Item;
  onClose: () => void;
  onPrint: () => void;
}) {
  const printDate = formatDate(new Date().toISOString());

  return (
    <div
      className="modal-overlay fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="print-area bg-white rounded-2xl shadow-xl w-full max-w-lg my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 인쇄용 헤더 */}
        <div className="border-b border-slate-200 p-6">
          <div className="hidden print:block text-center mb-4">
            <h2 className="text-xl font-black text-slate-800">
              (주)동남 안전보건교육 이수 확인서
            </h2>
            <p className="text-xs text-slate-500 mt-1">출력일: {printDate}</p>
          </div>
          <div className="flex justify-between items-center print:hidden">
            <h2 className="text-lg font-bold text-slate-800">수료자 상세정보</h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <Section title="기본 정보">
            <InfoRow label="성 명" value={item.name} bold />
            <InfoRow label="소 속" value={item.affiliation} />
            <InfoRow label="생년월일" value={formatDate(item.birthDate)} />
            <InfoRow label="연 락 처" value={item.phone} />
            {item.vehicleNumber && (
              <InfoRow label="차량번호" value={item.vehicleNumber} mono />
            )}
          </Section>

          <Section title="교육 정보">
            <InfoRow label="교육 대상" value={item.targetLabel} />
            <InfoRow label="응 시 일" value={formatDate(item.createdAt)} />
            <div className="flex justify-between items-center">
              <span className="text-slate-500 text-sm">상 태</span>
              {statusBadge(item.status)}
            </div>
            {item.score !== null && (
              <InfoRow label="시험점수" value={`${item.score} / 10`} />
            )}
          </Section>

          {item.completionNumber && (
            <Section title="수료 정보">
              <InfoRow label="수료번호" value={item.completionNumber} mono />
              <InfoRow label="수 료 일" value={formatDate(item.completedAt)} />
              <InfoRow
                label="유효기간"
                value={`${formatDate(item.validUntil)}까지`}
                highlight
              />
            </Section>
          )}

          <div className="hidden print:block border-t border-slate-300 pt-6 mt-6">
            <p className="text-xs text-slate-500 text-center">
              ※ 본 문서는 안전보건교육 수료 확인 용도로만 사용됩니다.
            </p>
            <div className="flex justify-end mt-4">
              <div className="text-sm">
                <span className="mr-2">확인</span>
                <span className="inline-block border-b-2 border-slate-400 w-24">&nbsp;</span>
                <span className="ml-1">(인)</span>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-200 p-4 flex gap-2 no-print">
          <button onClick={onClose} className="btn-secondary flex-1">
            닫기
          </button>
          <button onClick={onPrint} className="btn-primary flex-1">
            🖨️ 인쇄 / PDF 저장
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-200 pb-1">
        {title}
      </h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
  bold,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-center gap-3">
      <span className="text-slate-500 text-sm shrink-0">{label}</span>
      <span
        className={`text-right break-all ${mono ? 'font-mono text-xs' : 'text-base'} ${
          bold ? 'font-bold text-lg' : 'font-semibold'
        } ${highlight ? 'text-emerald-700' : 'text-slate-800'}`}
      >
        {value}
      </span>
    </div>
  );
}
