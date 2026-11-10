'use client';

import { normalizeKrPhone } from '@/lib/phone';
import { useCallback, useEffect, useState } from 'react';
import { formatDate } from '@/lib/format';
import StatCardButton from '@/components/StatCardButton';

interface Item {
  sessionId: string;
  name: string;
  affiliation: string;
  companyId: string | null;
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

/** 남은일수 색칩: 🟢31일↑ / 🟡30일 이내 / 🔴만료(경계: 시각이 지났으면 D-0이어도 만료) */
function DaysChip({ validUntil }: { validUntil: string | null }) {
  if (!validUntil) return <span className="text-[11px] text-slate-300">-</span>;
  // 만료 시각이 이미 지났으면 남은일수 계산 전에 만료 처리(만료 당일 🟡 D-0 오표시 방지)
  if (new Date(validUntil).getTime() <= Date.now()) {
    const over = Math.max(0, Math.floor((Date.now() - new Date(validUntil).getTime()) / (24 * 3600 * 1000)));
    return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-700">🔴 만료{over > 0 ? ` ${over}일` : ''}</span>;
  }
  const d = daysLeftOf(validUntil) ?? 0;
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
  const [editing, setEditing] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const [notice, setNotice] = useState('');

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
      if (e.key !== 'Escape') return;
      // 수정·삭제 창이 열려 있으면 그것만 닫는다
      if (editing || deleting) { setEditing(null); setDeleting(null); }
      else setSelected(null);
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [editing, deleting]);

  const handlePrint = () => {
    window.print();
  };

  // 수정·삭제 완료 → 창을 닫고 안내를 위에 남긴 뒤 목록 갱신
  const afterChange = async (message: string) => {
    setEditing(null);
    setDeleting(null);
    setSelected(null);
    setNotice(message);
    await load();
  };

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800 no-print">수료 현황</h1>

      {notice && (
        <div className="card bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-start justify-between gap-3 no-print">
          <p className="whitespace-pre-line">{notice}</p>
          <button onClick={() => setNotice('')} className="shrink-0 text-emerald-700 text-lg leading-none" aria-label="안내 닫기">×</button>
        </div>
      )}

      {/* ① 숫자 카드 (클릭 = 필터 + 검색어·대상 초기화 — 카드 숫자와 목록 일치) */}
      <div className="grid grid-cols-4 gap-2 no-print">
        {([
          { key: '', label: '전체', n: items.length, color: undefined },
          { key: 'ok', label: '✅ 유효', n: counts.ok, color: 'text-emerald-700' },
          { key: 'expiring', label: '⚠ 만료임박', n: counts.expiring, color: 'text-amber-700' },
          { key: 'expired', label: '🔴 만료', n: counts.expired, color: 'text-red-600' },
        ] as const).map((c) => (
          <StatCardButton key={c.key || 'all'} label={c.label} value={c.n} color={c.color} active={bucket === c.key}
            onClick={() => {
              setBucket(c.key); setPage(1);
              if (keyword || targetType) { setKeyword(''); setTargetType(''); load('', yearSel, ''); }
            }} />
        ))}
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
          onEdit={() => setEditing(selected)}
          onDelete={() => setDeleting(selected)}
        />
      )}
      {editing && (
        <EditRecordModal item={editing} onClose={() => setEditing(null)} onDone={afterChange} />
      )}
      {deleting && (
        <DeleteRecordModal item={deleting} onClose={() => setDeleting(null)} onDone={afterChange} />
      )}
    </main>
  );
}

function DetailModal({
  item,
  onClose,
  onPrint,
  onEdit,
  onDelete,
}: {
  item: Item;
  onClose: () => void;
  onPrint: () => void;
  onEdit: () => void;
  onDelete: () => void;
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

          <DeviceLine sessionId={item.sessionId} />

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
          <div className="flex gap-2">
            <button
              onClick={onEdit}
              className="flex-1 rounded-xl border-2 border-brand bg-white px-5 py-3 text-sm font-bold text-brand transition active:scale-95 hover:bg-brand/5"
            >
              ✏️ 수정
            </button>
            <button
              onClick={onDelete}
              className="flex-1 rounded-xl border-2 border-red-500 bg-white px-5 py-3 text-sm font-bold text-red-600 transition active:scale-95 hover:bg-red-50"
            >
              🗑️ 삭제
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 이 수료자로 기억된 휴대폰 수와 [모두 해제] — 권한(SESSION_DELETE)이 없으면 표시하지 않는다. */
function DeviceLine({ sessionId }: { sessionId: string }) {
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}/devices`, { cache: 'no-store' });
      if (!res.ok) { setCount(null); return; }
      const json = await res.json();
      setCount(typeof json?.data?.count === 'number' ? json.data.count : null);
    } catch {
      setCount(null);
    }
  }, [sessionId]);
  useEffect(() => { load(); }, [load]);
  if (count === null) return null;
  const revokeAll = async () => {
    if (!confirm(`이 수료자로 기억된 휴대폰 ${count}대를 모두 해제할까요? 해당 휴대폰은 다음 접속 때 다시 입력해야 합니다.`)) return;
    setBusy(true); setMsg('');
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}/devices`, { method: 'DELETE' });
      const json = await res.json();
      setMsg(json?.success ? `${json.data.revoked}대를 해제했습니다.` : json?.message || '해제하지 못했습니다.');
      await load();
    } catch {
      setMsg('네트워크 오류입니다.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="print:hidden rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-slate-600">기억된 휴대폰 <b>{count}</b>대</span>
        {count > 0 && (
          <button type="button" onClick={revokeAll} disabled={busy} className="rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-600 disabled:opacity-50">
            {busy ? '해제 중…' : '모두 해제'}
          </button>
        )}
      </div>
      {msg && <p className="mt-1 text-xs text-slate-500">{msg}</p>}
    </div>
  );
}

/** 수료 기록 수정 — 교육 대상은 수정 불가. 저장 시 서버가 권한·업체 상태를 다시 확인한다. */
function EditRecordModal({
  item,
  onClose,
  onDone,
}: {
  item: Item;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [name, setName] = useState(item.name);
  const [birthDate, setBirthDate] = useState((item.birthDate ?? '').substring(0, 10));
  const [phone, setPhone] = useState(item.phone ?? '');
  const [vehicleNumber, setVehicleNumber] = useState(item.vehicleNumber ?? '');
  const [newCompany, setNewCompany] = useState<{ id: string; name: string } | null>(null);
  const [companyKeyword, setCompanyKeyword] = useState('');
  const [companyResults, setCompanyResults] = useState<{ id: string; name: string }[] | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const searchCompany = async () => {
    const kw = companyKeyword.trim();
    if (!kw) return;
    setErr('');
    try {
      // 공개 검색 API는 사용중지 업체를 빼고 돌려준다(숨김 업체도 사용중지 상태).
      const res = await fetch(`/api/companies?keyword=${encodeURIComponent(kw)}`);
      const json = await res.json();
      if (!json.success) { setErr(json.message || '업체 검색 실패'); return; }
      setCompanyResults((json.data.items as { id: string; name: string }[]).filter((c) => c.id !== item.companyId));
    } catch {
      setErr('네트워크 오류');
    }
  };

  const save = async () => {
    if (!reason.trim()) { setErr('수정 사유를 입력해 주세요.'); return; }
    setSaving(true);
    setErr('');
    try {
      const res = await fetch(`/api/admin/sessions/${item.sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          birthDate,
          phone,
          vehicleNumber,
          companyId: newCompany?.id ?? null,
          reason,
        }),
      });
      const json = await res.json();
      if (!json.success) { setErr(json.message || '수정 실패'); setSaving(false); return; }
      const notices: string[] = json.data.notices ?? [];
      onDone(['수정했습니다.', ...notices].join('\n'));
    } catch {
      setErr('네트워크 오류입니다. 잠시 후 다시 시도해 주세요.');
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay fixed inset-0 z-[60] bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-8 p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-slate-800">수료 기록 수정</h3>
        <p className="text-xs text-slate-500">
          같은 사람(이름·생년월일·연락처 일치)의 다른 교육 기록도 함께 수정됩니다. 서약서·이행각서·과거 허가서는 바뀌지 않습니다.
        </p>
        <div>
          <label className="label">이름 <span className="text-red-500">*</span></label>
          <input className="input-base" maxLength={50} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">생년월일 <span className="text-red-500">*</span></label>
          <input type="date" max="9999-12-31" className="input-base" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </div>
        <div>
          <label className="label">연락처 <span className="text-red-500">*</span></label>
          <input type="tel" className="input-base" inputMode="numeric" value={phone} onChange={(e) => setPhone(normalizeKrPhone(e.target.value))} />
        </div>
        <div>
          <label className="label">차량번호</label>
          <input className="input-base" maxLength={30} value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} />
        </div>
        <div>
          <label className="label">교육 대상 (수정 불가)</label>
          <p className="text-sm text-slate-600">{item.targetLabel}</p>
        </div>
        <div className="space-y-1.5">
          <label className="label">소속 업체</label>
          <p className="text-sm text-slate-700">
            현재: {item.affiliation}
            {newCompany && <span className="font-bold text-brand"> → {newCompany.name}</span>}
            {newCompany && (
              <button type="button" onClick={() => setNewCompany(null)} className="ml-2 text-xs text-slate-500 underline">변경 취소</button>
            )}
          </p>
          <div className="flex gap-2 items-stretch">
            <input
              className="input-base flex-1 min-w-0"
              placeholder="바꿀 업체명 검색"
              value={companyKeyword}
              onChange={(e) => setCompanyKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchCompany(); } }}
            />
            <button type="button" onClick={searchCompany} className="shrink-0 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold px-4 whitespace-nowrap hover:bg-slate-50">검색</button>
          </div>
          {companyResults && (
            companyResults.length === 0 ? (
              <p className="text-xs text-slate-500">선택할 수 있는 업체가 없습니다.</p>
            ) : (
              <ul className="max-h-36 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                {companyResults.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => { setNewCompany({ id: c.id, name: c.name }); setCompanyResults(null); setCompanyKeyword(''); }}
                      className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >{c.name}</button>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
        <div>
          <label className="label">수정 사유 <span className="text-red-500">*</span></label>
          <textarea className="input-base min-h-[72px]" placeholder="예: 이름 오타 정정" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-2 justify-end pt-1">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>취소</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </div>
  );
}

/** 수료 기록 삭제 — 선택한 1건만. 전체 내용을 로그에 저장한 뒤 삭제된다. */
function DeleteRecordModal({
  item,
  onClose,
  onDone,
}: {
  item: Item;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    if (!reason.trim()) { setErr('삭제 사유를 입력해 주세요.'); return; }
    setSaving(true);
    setErr('');
    try {
      const res = await fetch(`/api/admin/sessions/${item.sessionId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json();
      if (!json.success) { setErr(json.message || '삭제 실패'); setSaving(false); return; }
      const notices: string[] = json.data.notices ?? [];
      onDone([`${item.name} 기록을 삭제했습니다.`, ...notices].join('\n'));
    } catch {
      setErr('네트워크 오류입니다. 잠시 후 다시 시도해 주세요.');
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-red-700">수료 기록 삭제</h3>
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-slate-700 space-y-1">
          <p>
            <span className="font-bold text-red-700">{item.name}</span> ({item.targetLabel})
            {item.completionNumber ? ` · ${item.completionNumber}` : ''} 기록 1건을 삭제합니다.
          </p>
          <p className="text-xs text-slate-600">수료·시험·시청 기록이 함께 지워지고, 지운 내용과 사유는 로그에 남습니다. 작업허가서에 쓰인 기록은 삭제되지 않습니다.</p>
        </div>
        <div>
          <label className="label">삭제 사유 <span className="text-red-500">*</span></label>
          <textarea className="input-base min-h-[72px]" placeholder="예: 잘못 등록된 테스트 기록" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-2 justify-end pt-1">
          <button className="btn-secondary" onClick={onClose} disabled={saving}>취소</button>
          <button
            className="whitespace-nowrap text-sm px-5 py-2 rounded-lg font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            onClick={submit}
            disabled={saving}
          >{saving ? '처리 중…' : '삭제'}</button>
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
