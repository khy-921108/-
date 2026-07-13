'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SUPPLEMENTAL_WORKS } from '@/lib/work-permit-constants';
import { STAGE_BADGE_CLASS, type Stage } from '@/lib/work-permit-stage';
import { writeDraft, clearDraft } from '@/lib/work-permit-draft';
import SignaturePad from '@/components/SignaturePad';

interface CopySource {
  companyId: string | null;
  companyName: string | null;
  workName: string;
  workLocation: string;
  equipmentNo: string;
  applicantTitle: string;
  workContent: string;
  supplemental: Record<string, 'Y' | 'N'>;
  riskFactors: string[];
  safetyMeasures: string[];
}

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
  copy?: CopySource;
}

function fmtDateTime(iso: string): string {
  if (!iso) return '-';
  const k = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

const PAGE_SIZE = 5;

// 업체용 쉬운 말(단계 판정은 공용 stage 재사용 — 관리자·포털과 불일치 금지)
const FRIENDLY_STATUS: Record<string, string> = {
  WAITING: '신청 접수 — 승인 대기',
  SITE_CHECK: '승인 완료 — 현장 도착 후 [현장 TBM 진행]',
  WITNESS_WAIT: '✅ TBM 제출 — 현장담당자 확인 중 (2차 입회)',
  THIRD_CHECK: '관련부서(공무) 확인 중',
  START_READY: '작업 개시 승인 대기',
  STARTED: '🔵 작업 중 — 종료 시 종료신고 안내',
  REPORT_WAIT: '종료 확인 대기',
  OVERDUE: '🔴 미종료 — 종료확인 필요',
  EXPIRED: '기간 경과',
  CLOSED: '✅ 작업 종료',
  REJECTED: '반려',
  IN_PROGRESS: '진행 중',
};

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

  // 작업 종료 신고(소장 직접)
  const [reportFor, setReportFor] = useState<Item | null>(null);
  const [reportSig, setReportSig] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportErr, setReportErr] = useState('');

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

  // 같은 내용으로 재신청 — 내용만 복사(날짜·서명·승인·TBM·참여자 제외), 오늘 날짜로 새로 신청.
  const reapply = (it: Item) => {
    const c = it.copy;
    if (!c || !c.companyId) { alert('이 허가서는 복사 재신청을 지원하지 않습니다.'); return; }
    clearDraft();
    writeDraft({
      applicant: { name: name.trim(), birthDate, phone, companyId: c.companyId },
      company: { id: c.companyId, name: c.companyName ?? '' },
      info: {
        workName: c.workName,
        workLocation: c.workLocation,
        equipmentNo: c.equipmentNo,
        workStart: '', // 🔴 작업일·시간은 복사하지 않음(오늘 날짜로 새로 입력)
        workEnd: '',
        workContent: c.workContent,
        applicantName: name.trim(),
        applicantTitle: c.applicantTitle,
      },
      supplemental: c.supplemental ?? {},
      tbmDetail: { workContent: c.workContent, riskFactors: c.riskFactors ?? [], safetyMeasures: c.safetyMeasures ?? [] },
      approval: {},
      participants: [], // 🔴 참여자·확인은 복사하지 않음(재입력)
      copied: true,
    });
    router.push('/work-permit/info');
  };

  // 현장 TBM 화면으로 이동 — 본인확인 정보를 sessionStorage로 전달(재입력 방지)
  const goTbm = (permitId: string) => {
    try {
      sessionStorage.setItem('wp_tbm_cred', JSON.stringify({ name, birthDate, phone }));
    } catch { /* */ }
    router.push(`/work-permit/tbm/${permitId}`);
  };

  const openReport = (it: Item) => { setReportSig(''); setReportErr(''); setReportFor(it); };
  const submitReport = async () => {
    if (!reportFor) return;
    if (!reportSig) { setReportErr('신고자(현장소장) 서명을 입력해 주세요.'); return; }
    setReportBusy(true); setReportErr('');
    try {
      const res = await fetch(`/api/work-permits/${reportFor.permitId}/complete-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, birthDate, phone, signature: reportSig }),
      });
      const json = await res.json();
      if (!json.success) { setReportErr(json.message || '종료신고 실패'); setReportBusy(false); return; }
      setReportFor(null); setReportBusy(false);
      search(month); // 목록 갱신 → "종료 확인 대기"로 전환
    } catch {
      setReportErr('네트워크 오류가 발생했습니다.'); setReportBusy(false);
    }
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
                    {it.stage && (
                      <p className="text-sm font-bold text-slate-700 mt-1">
                        {FRIENDLY_STATUS[it.stage.key] ?? it.stage.label}
                        <span className="text-[11px] font-normal text-slate-400"> ({it.stage.label})</span>
                      </p>
                    )}
                    <p className="text-xs text-slate-500 mt-0.5">{it.companyName}</p>
                    <p className="text-xs text-slate-600 mt-0.5">📅 {fmtDateTime(it.workStart)} ~ {fmtDateTime(it.workEnd)}</p>
                    {supp.length > 0 && (
                      <p className="text-xs text-amber-700 mt-0.5">보충: {supp.join(', ')}</p>
                    )}
                  </div>
                  <span className="text-slate-300 text-lg shrink-0">›</span>
                </div>
                {/* 승인완료~TBM 전: 현장 TBM 진행 */}
                {it.stage?.key === 'SITE_CHECK' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); goTbm(it.permitId); }}
                    className="w-full rounded-lg bg-emerald-600 text-white text-sm font-bold py-2 hover:bg-emerald-700"
                  >
                    🦺 현장 TBM 진행 (사진·작업자 서명)
                  </button>
                )}
                {/* TBM 제출 후~2차 전: 작은 링크로 작업자 서명 추가만 */}
                {it.stage?.key === 'WITNESS_WAIT' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); goTbm(it.permitId); }}
                    className="text-xs font-bold text-emerald-700 underline"
                  >
                    + 작업자 서명 추가 (2차 확인 전까지)
                  </button>
                )}
                {/* 작업 중(개시 후): 소장 직접 종료 신고 */}
                {it.stage?.key === 'STARTED' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); openReport(it); }}
                    className="w-full rounded-lg bg-slate-800 text-white text-sm font-bold py-2 hover:bg-slate-900"
                  >
                    🏁 작업 종료 신고
                  </button>
                )}
                <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
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
                  {it.copy?.companyId && (
                    <button
                      onClick={(e) => { e.stopPropagation(); reapply(it); }}
                      className="ml-auto text-xs font-bold text-emerald-700 hover:underline"
                    >
                      📄 같은 내용으로 재신청
                    </button>
                  )}
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

      {/* 작업 종료 신고 모달 (소장 직접) */}
      {reportFor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !reportBusy && setReportFor(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800">🏁 작업 종료 신고 <span className="text-xs font-normal text-slate-500 font-mono">{reportFor.permitNumber}</span></h3>
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-slate-700">
              현장 정리·화기 후 확인 등 마무리 조치를 <b>모두 마친 뒤</b> 신고해 주세요. 신고 후 안전환경 담당자의 <b>최종 종료확인</b>이 진행됩니다.
            </div>
            <div>
              <label className="label">신고자(현장소장) 서명 <span className="text-red-500">*</span></label>
              <SignaturePad onChange={setReportSig} />
            </div>
            {reportErr && <p className="text-sm text-red-600">{reportErr}</p>}
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setReportFor(null)} disabled={reportBusy}>취소</button>
              <button
                className="text-sm px-5 py-2 rounded-lg font-bold bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50"
                onClick={submitReport} disabled={reportBusy || !reportSig}
              >{reportBusy ? '신고 중…' : '종료 신고'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
