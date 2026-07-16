'use client';

import { useEffect, useState } from 'react';
import { formatDate } from '@/lib/format';
import StatCardButton from '@/components/StatCardButton';

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

// 남은일수: validUntil 기준(만료=음수). 수료 없으면 null.
function daysLeftOf(validUntil: string | null): number | null {
  if (!validUntil) return null;
  return Math.ceil((new Date(validUntil).getTime() - Date.now()) / (24 * 3600 * 1000));
}

// 3분류 버킷: ok(유효 31일↑) / expiring(30일 이내) / expired(만료) / etc(진행중·불합격 등)
function bucketOf(it: Item): 'ok' | 'expiring' | 'expired' | 'etc' {
  if (it.status === 'EXPIRED') return 'expired';
  if (it.status === 'VALID') {
    const d = daysLeftOf(it.validUntil);
    return d !== null && d <= 30 ? 'expiring' : 'ok';
  }
  return 'etc';
}

/** 전화 반가림: 010-****-5678 */
function maskPhone(phone: string): string {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length < 8) return phone || '-';
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

/** 남은일수 색칩: 🟢31일↑ / 🟡30일 이내 / 🔴만료 */
function DaysChip({ validUntil }: { validUntil: string | null }) {
  const d = daysLeftOf(validUntil);
  if (d === null) return <span className="text-[11px] text-slate-300">-</span>;
  if (d < 0) return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700">🔴 만료 {Math.abs(d)}일</span>;
  if (d <= 30) return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700">🟡 D-{d}</span>;
  return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700">🟢 D-{d}</span>;
}

const PAGE_SIZE = 10;

export default function AdminCompletionsPage() {
  const thisYear = String(new Date().getFullYear());
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [bucket, setBucket] = useState<'' | 'ok' | 'expiring' | 'expired'>('');
  const [targetType, setTargetType] = useState('');
  const [keyword, setKeyword] = useState('');
  const [yearSel, setYearSel] = useState(thisYear);
  const [page, setPage] = useState(1);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Item | null>(null);

  const load = async (kw = keyword, y = yearSel, tt = targetType) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (tt) params.set('targetType', tt);
    if (kw) params.set('keyword', kw);
    params.set('year', y);

    const res = await fetch(`/api/admin/completions?${params.toString()}`);
    const json = await res.json();
    if (json.success) setItems(json.data.items);
    setLoading(false);
  };

  useEffect(() => {
    setPage(1);
    load(keyword, yearSel, targetType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearSel, targetType]);

  // 숫자 카드 건수 = 조회 범위(연도) 전체 기준
  const counts = { ok: 0, expiring: 0, expired: 0 };
  items.forEach((it) => { const b = bucketOf(it); if (b !== 'etc') counts[b] += 1; });

  // 카드 필터 + 만료 임박순 정렬(챙길 사람 맨 위: 유효기간 오름차순, 수료 없음은 뒤)
  const filtered = (bucket ? items.filter((it) => bucketOf(it) === bucket) : items)
    .slice()
    .sort((a, b) => {
      if (!a.validUntil && !b.validUntil) return 0;
      if (!a.validUntil) return 1;
      if (!b.validUntil) return -1;
      return new Date(a.validUntil).getTime() - new Date(b.validUntil).getTime();
    });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const visible = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  const togglePhone = (id: string) => {
    setRevealed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

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

  const handleDelete = async (item: Item) => {
    const isProtected = item.status === 'VALID' || item.status === 'EXPIRED';
    if (isProtected) {
      alert('수료 이력이 있는 세션은 삭제할 수 없습니다.\n법적 이행 기록은 보존됩니다.');
      return;
    }
    const ok = confirm(
      `[${item.name}] 세션을 삭제하시겠습니까?\n시청 기록/시험 이력도 함께 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.`
    );
    if (!ok) return;

    const res = await fetch(`/api/admin/sessions/${item.sessionId}`, {
      method: 'DELETE',
    });
    const json = await res.json();
    if (!json.success) {
      alert(json.message || '삭제 실패');
      return;
    }
    setSelected(null);
    await load();
  };

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800 no-print">수료 현황</h1>

      {/* ① 숫자 카드 (클릭 = 필터) — 3화면 공통 구조 */}
      <div className="grid grid-cols-4 gap-2 no-print">
        <StatCardButton label="전체" value={items.length} active={bucket === ''} onClick={() => { setBucket(''); setPage(1); }} />
        <StatCardButton label="✅ 유효" value={counts.ok} color="text-emerald-700" active={bucket === 'ok'} onClick={() => { setBucket('ok'); setPage(1); }} />
        <StatCardButton label="⚠ 만료임박" value={counts.expiring} color="text-amber-700" active={bucket === 'expiring'} onClick={() => { setBucket('expiring'); setPage(1); }} />
        <StatCardButton label="🔴 만료" value={counts.expired} color="text-red-600" active={bucket === 'expired'} onClick={() => { setBucket('expired'); setPage(1); }} />
      </div>

      <div className="card space-y-3 no-print">
        {/* ② 필터 줄 — 연도(응시일 기준) + 대상 */}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setYearSel((y) => String(Number(y) - 1))}
              className="h-9 w-9 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 text-lg leading-none"
              aria-label="이전 해"
            >◀</button>
            <span className="text-base font-bold text-slate-800 w-28 text-center">{yearSel}년</span>
            <button
              onClick={() => setYearSel((y) => String(Number(y) + 1))}
              disabled={Number(yearSel) >= Number(thisYear)}
              className="h-9 w-9 rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-30 text-lg leading-none"
              aria-label="다음 해"
            >▶</button>
          </div>
          <select
            className="input-base !w-auto"
            value={targetType}
            onChange={(e) => { setTargetType(e.target.value); setPage(1); }}
          >
            {TARGETS.map((t) => (
              <option key={t.code} value={t.code}>
                대상: {t.label}
              </option>
            ))}
          </select>
        </div>
        {/* ③ 통합 검색 */}
        <div className="flex gap-2 items-stretch">
          <input
            className="input-base flex-1 min-w-0"
            placeholder="이름·소속·차량번호 검색"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); load(keyword); } }}
          />
          <button
            onClick={() => { setPage(1); load(keyword); }}
            className="shrink-0 rounded-xl bg-brand text-white text-sm font-semibold px-5 whitespace-nowrap disabled:opacity-50"
            disabled={loading}
          >{loading ? '조회 중…' : '검색'}</button>
        </div>
      </div>

      <div className="space-y-2 no-print">
        <p className="text-xs text-slate-500">
          {yearSel}년 · {bucket === '' ? '전체' : bucket === 'ok' ? '유효' : bucket === 'expiring' ? '만료임박' : '만료'} {filtered.length}건 · 만료 임박순 · 행 클릭 시 상세
        </p>

        {/* PC: 표 (만료 임박순) */}
        <div className="hidden sm:block card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 border-b border-slate-200 bg-slate-50">
                <th className="text-left py-2 px-3">이름</th>
                <th className="text-left px-2">소속</th>
                <th className="text-left px-2">대상</th>
                <th className="text-center px-2">상태</th>
                <th className="text-left px-2">유효기간</th>
                <th className="text-left px-2">남은일수</th>
                <th className="text-left px-2">연락처</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((it) => (
                <tr key={it.sessionId} onClick={() => setSelected(it)}
                  className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer">
                  <td className="py-2 px-3 font-bold text-slate-800 whitespace-nowrap">{it.name}</td>
                  <td className="px-2 text-slate-600">{it.affiliation}</td>
                  <td className="px-2 text-slate-600 whitespace-nowrap">{it.targetLabel}{it.vehicleNumber ? ` 🚗${it.vehicleNumber}` : ''}</td>
                  <td className="px-2 text-center">{statusBadge(it.status)}</td>
                  <td className="px-2 text-slate-700 whitespace-nowrap">{it.validUntil ? it.validUntil.substring(0, 10) : '-'}</td>
                  <td className="px-2"><DaysChip validUntil={it.validUntil} /></td>
                  <td className="px-2 whitespace-nowrap">
                    <button
                      onClick={(e) => { e.stopPropagation(); togglePhone(it.sessionId); }}
                      className="font-mono text-xs text-slate-600 hover:underline"
                      title="클릭하면 전체 표시/가림"
                    >{revealed.has(it.sessionId) ? it.phone : maskPhone(it.phone)}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 폰: 카드 */}
        <div className="sm:hidden space-y-2">
          {visible.map((it) => (
            <button
              type="button"
              key={it.sessionId}
              onClick={() => setSelected(it)}
              className="card space-y-1.5 w-full text-left hover:shadow-md transition"
            >
              <div className="flex justify-between items-start gap-2">
                <p className="font-bold text-slate-800">
                  {it.name} <span className="font-normal text-slate-500 text-xs">({it.affiliation})</span>
                </p>
                {statusBadge(it.status)}
              </div>
              <p className="text-xs text-slate-500">
                {it.targetLabel}{it.vehicleNumber ? ` · 🚗 ${it.vehicleNumber}` : ''} ·{' '}
                <span
                  role="button" tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); togglePhone(it.sessionId); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); togglePhone(it.sessionId); } }}
                  className="font-mono hover:underline"
                >{revealed.has(it.sessionId) ? it.phone : maskPhone(it.phone)}</span>
              </p>
              <p className="text-xs text-slate-600 flex items-center gap-2">
                유효기간 {it.validUntil ? it.validUntil.substring(0, 10) : '-'} <DaysChip validUntil={it.validUntil} />
              </p>
            </button>
          ))}
        </div>

        {filtered.length === 0 && !loading && (
          <div className="card text-center text-slate-500 py-8">조회 결과가 없습니다.</div>
        )}

        {/* 페이지네이션 (10개씩 — 3화면 공통) */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={curPage <= 1}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 disabled:opacity-30">◀ 이전</button>
            <span className="text-sm font-semibold text-slate-700">{curPage} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={curPage >= totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 disabled:opacity-30">다음 ▶</button>
          </div>
        )}
      </div>

      {selected && (
        <DetailModal
          item={selected}
          onClose={() => setSelected(null)}
          onPrint={handlePrint}
          onDelete={() => handleDelete(selected)}
        />
      )}
    </main>
  );
}

function DetailModal({
  item,
  onClose,
  onPrint,
  onDelete,
}: {
  item: Item;
  onClose: () => void;
  onPrint: () => void;
  onDelete: () => void;
}) {
  const isProtected = item.status === 'VALID' || item.status === 'EXPIRED';
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

        <div className="border-t border-slate-200 p-4 space-y-2 no-print">
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary flex-1">
              닫기
            </button>
            <button onClick={onPrint} className="btn-primary flex-1">
              🖨️ 인쇄 / PDF 저장
            </button>
          </div>
          {!isProtected && (
            <button
              onClick={onDelete}
              className="w-full rounded-xl border-2 border-red-500 bg-white px-5 py-3 text-sm font-bold text-red-600 transition active:scale-95 hover:bg-red-50"
            >
              🗑️ 세션 삭제 (시청·시험 이력 함께 삭제)
            </button>
          )}
          {isProtected && (
            <p className="text-xs text-slate-400 text-center pt-1">
              ※ 수료 이력이 있어 삭제할 수 없습니다.
            </p>
          )}
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
