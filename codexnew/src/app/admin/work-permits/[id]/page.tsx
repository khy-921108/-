'use client';

/**
 * 관리자 작업허가서 상세 — R-6 게이트③(-1 조회 / -2a 발급·입회 / -2b 3차확인·종료·작업개시)
 * 단계별 개별 액션(일괄 금지). 서버가 처리자·시각 기록, 권한·순서·공무 게이트 재검증.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import SignaturePad from '@/components/SignaturePad';
import { SUPPLEMENTAL_WORKS, SUPPLEMENTAL_CONFIRM_DEPT, type SupplementalKey } from '@/lib/work-permit-constants';
import { STAGE_BADGE_CLASS, type Stage } from '@/lib/work-permit-stage';

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '-';
  const k = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

interface Conf { name: string; signature?: string; confirmedAt?: string }
type ModalState =
  | null
  | { type: 'issue' | 'witness' | 'report' | 'confirm' }
  | { type: 'dept' | 'proxy'; supKey: SupplementalKey; label: string; dept: string };

function StageBadge({ stage }: { stage?: Stage }) {
  if (!stage) return null;
  return <span className={`rounded-full text-xs font-bold px-2.5 py-1 ${STAGE_BADGE_CLASS[stage.key]}`}>{stage.label}</span>;
}

function TriCell({ done, started }: { done: boolean; started: boolean }) {
  if (done) return <span className="text-emerald-600 font-bold">✅</span>;
  if (started) return <span className="rounded bg-amber-100 text-amber-700 text-[11px] font-bold px-1.5 py-0.5">미완료</span>;
  return <span className="text-slate-300 text-[11px]">TBM 전</span>;
}

function SigRow({ label, sub, signature, who, at, pending, action }: {
  label: string; sub?: string; signature?: string | null; who?: string | null; at?: string | null;
  pending?: string; action?: React.ReactNode;
}) {
  const signed = !!(signature && signature.startsWith('data:image/'));
  // 좁은 폭: 라벨 → 서명+시각 → 버튼 세로 스택 / 넓은 폭(sm↑): 기존 가로 배치
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 py-2 border-b border-slate-100 last:border-0">
      <div className="sm:w-28 sm:shrink-0">
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
      </div>
      <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
        {signed ? (
          <>
            <img src={signature!} alt="서명" className="h-9 border border-slate-200 rounded bg-white px-1 shrink-0" />
            <div className="text-xs text-slate-600 min-w-0 flex items-baseline gap-1 flex-wrap">
              {who ? (
                <span className="font-medium truncate">{who}</span>
              ) : (
                <span
                  className="text-slate-400 italic whitespace-nowrap cursor-help"
                  title="내 정보에서 부서·이름·직책을 등록하세요."
                >(정보 미등록)</span>
              )}
              {at && <span className="text-slate-400 whitespace-nowrap">· {fmtDateTime(at)}</span>}
            </div>
          </>
        ) : (
          <span className={`rounded-full text-xs font-medium px-2 py-0.5 whitespace-nowrap ${pending ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
            {pending ?? '미서명'}
          </span>
        )}
      </div>
      {action && <div className="flex flex-wrap gap-1.5 justify-end sm:shrink-0">{action}</div>}
    </div>
  );
}

export default function AdminWorkPermitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [me, setMe] = useState<{ role: string; permissions: string[]; signature?: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');

  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalState>(null);
  const [sig, setSig] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [reason, setReason] = useState('');
  const [restoreState, setRestoreState] = useState('');
  const [completedAt, setCompletedAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [modalErr, setModalErr] = useState('');

  // 이전 단계로 되돌리기(반려와 별개)
  const [rbModal, setRbModal] = useState<null | { step: 'issuer' | 'witness' | 'dept'; supKey?: string; label: string }>(null);
  const [rbReason, setRbReason] = useState('');
  const [rbSaving, setRbSaving] = useState(false);
  const [rbErr, setRbErr] = useState('');

  // 현장 추가 등록 무효 처리(정정)
  const [voidModal, setVoidModal] = useState<null | { index: number; label: string }>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidSaving, setVoidSaving] = useState(false);
  const [voidErr, setVoidErr] = useState('');

  const load = useCallback(async () => {
    // 읽기(조회)에 15초 클라 타임아웃 — Supabase 지연 시 화면이 매달리지 않게
    const tf = (url: string) => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 15000);
      return fetch(url, { cache: 'no-store', signal: ac.signal }).finally(() => clearTimeout(t));
    };
    try {
      const [pRes, mRes, phRes] = await Promise.all([
        tf(`/api/work-permits/${id}`),
        tf(`/api/admin/me`),
        tf(`/api/admin/work-permits/${id}/tbm-photos`),
      ]);
      const pJson = await pRes.json();
      if (pJson.success) setData(pJson.data);
      else setError(pJson.message || '조회 실패');
      const mJson = await mRes.json();
      if (mJson.success) setMe(mJson.data);
      const phJson = await phRes.json().catch(() => null);
      if (phJson?.success) setPhotoUrls(phJson.data.urls ?? []);
    } catch {
      setError('네트워크 오류');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-10 text-center text-slate-500">불러오는 중…</div>;
  if (error || !data) return <div className="card text-center text-red-600 py-8">{error || '데이터 없음'}</div>;

  const info = data.info ?? {};
  const equipment: any[] = Array.isArray(data.equipment) ? data.equipment : [];
  const arrivals: any[] = Array.isArray(data.equipmentArrivals) ? data.equipmentArrivals : [];
  const additions: any[] = Array.isArray(data.fieldAdditions) ? data.fieldAdditions : [];
  const isHeavy = data.supplemental?.heavy === 'Y' || data.supplemental?.excavation === 'Y'; // 장비 관련(중장비·굴착) 공통 조건
  const tbm = data.tbm ?? {};
  const comp = data.completion ?? {};
  const deptConfs: Record<string, any> = data.deptConfirmations ?? {};
  const pledgeSigByName = new Map<string, boolean>(
    (data.docs?.pledges ?? []).map((p: any) => [(p.name ?? '').trim(), !!p.signature])
  );
  const checkedSupp = SUPPLEMENTAL_WORKS.filter((w) => data.supplemental?.[w.key] === 'Y');
  const participants: any[] = data.participants ?? [];
  const photoCount = Array.isArray(tbm.photos) ? tbm.photos.length : 0;
  const tbmStarted = photoCount > 0 || !!(tbm.safetyInstructions && String(tbm.safetyInstructions).trim());
  const confirmedCount = participants.filter((p: any) => !!p.tbmSignature).length; // ⑥ 참여자별(이름||전화) 매칭
  // 🔴 2차 격상: 사진 ≥1 + 참여자 전원 서명이어야 2차 승인 가능(서버도 차단).
  const tbmComplete = photoCount >= 1 && participants.length > 0 && confirmedCount >= participants.length;
  const tbmReason = `TBM 미완료: 사진 ${photoCount}/1, 서명 ${confirmedCount}/${participants.length}명`;

  const isSuper = me?.role === 'SUPER';
  const perms = me?.permissions ?? [];
  const hasApprove = isSuper || perms.includes('WORKPERMITS_APPROVE');
  const hasDeptConfirm = perms.includes('WORKPERMITS_DEPT_CONFIRM'); // 실제 공무 계정(명시 부여)

  const issuerSigned = !!(data.issuer?.signature && String(data.issuer.signature).startsWith('data:image/'));
  const witness = tbm.witness ?? null;
  const witnessSigned = !!(witness?.signature && String(witness.signature).startsWith('data:image/'));
  const reportDone = !!comp.workerSignature;
  const confirmDone = !!comp.confirmSignature;

  // 작업개시 게이트(클라 미리보기 — 최종 판정은 서버)
  const startMissing: string[] = [];
  if (!issuerSigned) startMissing.push('1차 발급');
  if (!witnessSigned) startMissing.push('2차 입회');
  checkedSupp.forEach((w) => {
    if (!deptConfs[w.key]?.signature) startMissing.push(`${w.label} 별지 ${SUPPLEMENTAL_CONFIRM_DEPT[w.key]}확인`);
  });
  const canStart = startMissing.length === 0;
  // R-6 작업개시/종료 여부 = 실제 started_at/종료확인 (status 컬럼은 포털 승인과 공유되어 신뢰 불가)
  const started = !!data.startedAt || !!comp.confirmSignature;
  const closed = !!comp.confirmSignature;

  // 보안검토①: 작업일(KST)이 지난 허가서는 승인·개시 버튼을 감춘다(서버도 차단). 종료·되돌리기는 허용.
  const isPast = (() => {
    if (!info.workEnd) return false;
    const p = (n: number) => String(n).padStart(2, '0');
    const d = new Date(new Date(info.workEnd).getTime() + 9 * 60 * 60 * 1000);
    const we = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    const n = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const today = `${n.getUTCFullYear()}-${p(n.getUTCMonth() + 1)}-${p(n.getUTCDate())}`;
    return we < today;
  })();

  // R-6 ③-4: 서명자 이메일 → "부서 이름 직책" 라벨(미등록이면 이메일 앞부분)
  // GET가 이미 "부서 이름 직책"으로 변환(미등록이면 null)해 주므로 그대로 통과. 빈값은 null.
  const slabel = (v?: string | null) => (v && String(v).trim() ? v : null);

  const resetFields = () => { setSig(''); setTitle(''); setInstructions(tbm.safetyInstructions ?? ''); setReason(''); setRestoreState(comp.restoreState ?? ''); setCompletedAt(''); setModalErr(''); };
  const openModal = (m: ModalState) => { resetFields(); setModal(m); };

  // 2차 승인 진입 — TBM 완료(사진+전원 서명) 후에만(버튼도 비활성, 서버도 차단).
  const startWitness = () => {
    if (witnessSigned && !confirm('입회 서명을 다시 하면 덮어씁니다. 계속할까요?')) return;
    openModal({ type: 'witness' });
  };

  const submitSig = async () => {
    if (!modal) return;
    if (!sig) { setModalErr('서명을 입력해 주세요.'); return; }
    if (modal.type === 'witness' && !instructions.trim()) { setModalErr('오늘의 안전지시사항을 입력해 주세요.'); return; }
    if (modal.type === 'proxy' && !reason.trim()) { setModalErr('긴급 대리확인 사유를 입력해 주세요.'); return; }
    setSaving(true); setModalErr('');
    try {
      const b: any = { signature: sig };
      if (modal.type === 'issue') { b.action = 'issue'; b.title = title.trim(); }
      else if (modal.type === 'witness') { b.action = 'witness'; b.safetyInstructions = instructions.trim(); }
      else if (modal.type === 'dept') { b.action = 'dept_confirm'; b.supKey = modal.supKey; }
      else if (modal.type === 'proxy') { b.action = 'dept_proxy'; b.supKey = modal.supKey; b.reason = reason.trim(); }
      else if (modal.type === 'report') { b.action = 'complete_report'; b.restoreState = restoreState.trim(); if (completedAt) b.completedAt = new Date(completedAt).toISOString(); }
      else if (modal.type === 'confirm') { b.action = 'complete_confirm'; }
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 20000);
      const res = await fetch(`/api/admin/work-permits/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: ac.signal,
      }).finally(() => clearTimeout(t));
      const json = await res.json();
      if (!json.success) { setModalErr(json.message || '저장 실패'); setSaving(false); return; }
      // 저장 성공 → 즉시 UI 해제(모달 닫기). 화면 갱신은 백그라운드(느려도 안 매달림)
      setModal(null);
      setSaving(false);
      load();
    } catch {
      setModalErr('저장 지연 또는 네트워크 오류입니다. 잠시 후 다시 시도해 주세요.');
      setSaving(false);
    }
  };

  const startWork = async () => {
    setBanner('');
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 20000);
      const res = await fetch(`/api/admin/work-permits/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start_work' }), signal: ac.signal,
      }).finally(() => clearTimeout(t));
      const json = await res.json();
      if (!json.success) { setBanner(`⛔ ${json.message}`); return; }
      load();
    } catch { setBanner('저장 지연 또는 네트워크 오류입니다. 잠시 후 다시 시도해 주세요.'); }
  };

  // 콤팩트 버튼(내용만큼 폭) — btn-primary(w-full)를 쓰지 않아 승인 서명 줄 버튼 크기 통일.
  const btn = (label: string, on: () => void, kind: 'primary' | 'warn' = 'primary') => (
    <button
      onClick={on}
      className={`shrink-0 whitespace-nowrap text-xs px-3 py-1.5 rounded-lg font-bold text-white disabled:opacity-50 ${kind === 'warn' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-brand hover:opacity-90'}`}
    >{label}</button>
  );

  // ===== 이전 단계로 되돌리기 =====
  // 서버와 동일 판정: 별지(3차) → 2차 입회 → 1차 발급 중 "마지막 완료 단계" 1칸만.
  const rbSignedSup = checkedSupp
    .filter((w) => !!deptConfs[w.key]?.signature)
    .sort((a, b) => String(deptConfs[b.key]?.at ?? '').localeCompare(String(deptConfs[a.key]?.at ?? '')));
  const rbTarget: { step: 'issuer' | 'witness' | 'dept'; supKey?: string; label: string } | null =
    rbSignedSup.length > 0
      ? { step: 'dept', supKey: rbSignedSup[0].key, label: `${rbSignedSup[0].label} 별지 현장확인` }
      : witnessSigned
        ? { step: 'witness', label: '2차 입회' }
        : issuerSigned
          ? { step: 'issuer', label: '1차 발급' }
          : null;
  // 작업개시·종료신고 이후 불가. 권한은 서버가 최종 강제(SUPER=전부 / 그외=본인 서명 단계).
  const rbAllowed = !started && !comp.workerSignature;
  const rbCanRole = isSuper || hasApprove || hasDeptConfirm;
  const rbShow = (step: 'issuer' | 'witness' | 'dept', supKey?: string) =>
    rbAllowed && rbCanRole && rbTarget?.step === step && (step !== 'dept' || rbTarget?.supKey === supKey);
  const openRollback = (t: { step: 'issuer' | 'witness' | 'dept'; supKey?: string; label: string }) => {
    setRbReason(''); setRbErr(''); setRbModal(t);
  };
  const rbBtn = (t: { step: 'issuer' | 'witness' | 'dept'; supKey?: string; label: string }) => (
    <button onClick={() => openRollback(t)}
      className="shrink-0 whitespace-nowrap text-xs px-2.5 py-1.5 rounded-lg font-bold border border-red-300 text-red-600 hover:bg-red-50">
      ↩ 이전 단계로 되돌리기
    </button>
  );
  // 현장 추가 등록 무효 처리(정정) — 삭제·덮어쓰기 없이 사유·처리자·시각만 덧붙인다.
  const submitVoid = async () => {
    if (!voidModal) return;
    if (!voidReason.trim()) { setVoidErr('무효 사유를 입력해 주세요.'); return; }
    setVoidSaving(true); setVoidErr('');
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 20000);
      const res = await fetch(`/api/admin/work-permits/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'void_field_addition', index: voidModal.index, reason: voidReason.trim() }),
        signal: ac.signal,
      }).finally(() => clearTimeout(t));
      const json = await res.json();
      if (!json.success) { setVoidErr(json.message || '무효 처리 실패'); setVoidSaving(false); return; }
      setVoidModal(null); setVoidReason(''); setVoidSaving(false); load();
    } catch {
      setVoidErr('저장 지연 또는 네트워크 오류입니다. 잠시 후 다시 시도해 주세요.'); setVoidSaving(false);
    }
  };

  const submitRollback = async () => {
    if (!rbModal) return;
    if (!rbReason.trim()) { setRbErr('되돌리기 사유를 입력해 주세요.'); return; }
    setRbSaving(true); setRbErr('');
    try {
      const b: any = { action: 'rollback', reason: rbReason.trim(), expectedStep: rbModal.step };
      if (rbModal.supKey) b.expectedSupKey = rbModal.supKey;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 20000);
      const res = await fetch(`/api/admin/work-permits/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), signal: ac.signal,
      }).finally(() => clearTimeout(t));
      const json = await res.json();
      if (!json.success) { setRbErr(json.message || '되돌리기 실패'); setRbSaving(false); return; }
      setRbModal(null); setRbSaving(false); load();
    } catch {
      setRbErr('저장 지연 또는 네트워크 오류입니다. 잠시 후 다시 시도해 주세요.'); setRbSaving(false);
    }
  };

  return (
    <main className="space-y-5">
      {/* 헤더 */}
      <div className="card">
        <a href="/admin/work-permits" className="text-xs text-slate-500 hover:underline">← 작업허가 목록</a>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-1">
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xl sm:text-3xl font-extrabold tracking-tight text-brand whitespace-nowrap">{data.permitNumber}</span>
            <StageBadge stage={data.stage} />
          </div>
          {/* 콤팩트 버튼(내용만큼 폭) — btn-secondary(w-full)는 flex 안에서 줄바꿈을 유발해 사용하지 않음 */}
          <div className="flex gap-2 flex-wrap">
            {/* 현장 입회 중 합류자 추가·장비 도착 등록용 — 기존 TBM 화면 재사용(종료확인 후 숨김) */}
            {!closed && (
              <a href={`/work-permit/tbm/${id}`} target="_blank" rel="noreferrer" className="shrink-0 whitespace-nowrap rounded-xl bg-emerald-600 text-white text-sm font-bold px-4 py-2 hover:bg-emerald-700">🦺 현장 TBM 화면 열기</a>
            )}
            <a href={`/work-permit/print/${id}`} target="_blank" rel="noreferrer" className="shrink-0 whitespace-nowrap rounded-xl border-2 border-brand bg-white text-brand text-sm font-bold px-4 py-2 hover:bg-brand/5">🖨 인쇄</a>
            <a href={`/api/work-permits/${id}/xlsx`} className="shrink-0 whitespace-nowrap rounded-xl border-2 border-brand bg-white text-brand text-sm font-bold px-4 py-2 hover:bg-brand/5">📥 회사양식 xlsx</a>
          </div>
        </div>
        <p className="text-sm text-slate-600 mt-2">{info.workName} · {data.companyName}</p>
      </div>

      {banner && <div className="card bg-red-50 border border-red-200 text-red-700 text-sm">{banner}</div>}

      {/* 미종료 안내 — 자동 종료 없음, 표시·안내만 */}
      {data.stage?.key === 'OVERDUE' && (
        <div className="card bg-red-50 border border-red-200 text-red-700 text-sm">
          🔴 <b>미종료</b> — 작업 종료 예정일시가 지났으나 종료확인이 완료되지 않았습니다. 아래 <b>작업완료(종료 신고 → 확인)</b>를 진행해 주세요.
        </div>
      )}
      {data.stage?.key === 'EXPIRED' && (
        <div className="card bg-slate-50 border border-slate-200 text-slate-600 text-sm">
          ⚪ <b>기간 경과</b> — 작업개시 없이 예정일시가 지났습니다. 필요 시 되돌리기 또는 재신청으로 처리하세요.
        </div>
      )}

      {/* 기본정보 */}
      <section className="card space-y-1.5 text-sm">
        <h2 className="font-bold text-slate-700 mb-2">기본정보</h2>
        <Row k="작업명" v={info.workName} />
        <Row k="업체" v={data.companyName} />
        <Row k="작업장소" v={info.workLocation} />
        <Row k="장치번호/명" v={info.equipmentNo} />
        <Row k="작업개요" v={info.workContent} />
        <Row k="작업일시" v={`${fmtDateTime(info.workStart)} ~ ${fmtDateTime(info.workEnd)}`} />
        <Row k="신청인" v={`${info.applicantTitle ? info.applicantTitle + ' ' : ''}${info.applicantName ?? ''}`} />
        <Row k="신청일시" v={fmtDateTime(data.createdAt)} />
      </section>

      {/* 진행 타임라인 */}
      <section className="card text-sm">
        <h2 className="font-bold text-slate-700 mb-2">🕒 진행 타임라인</h2>
        <ul className="space-y-1 text-xs">
          {([
            ['1차 발급', data.issuer?.at],
            ['TBM 제출', tbm.tbmSubmittedAt],
            ['2차 입회', tbm.witness?.at],
            ['작업 개시', data.startedAt],
            [`현장 합류 ${data.fieldJoinCount ?? 0}건`, data.lastFieldJoinAt ?? null],
            [`장비 도착 ${arrivals.length}건`, arrivals.length > 0 ? arrivals[arrivals.length - 1].at : null],
            ['종료 신고', comp.reportAt],
            ['종료 확인', comp.confirmAt],
          ] as [string, string | null][]).map(([label, at], i) => {
            const isCount = label.includes('건');
            const done = isCount ? !label.startsWith('현장 합류 0') && !label.startsWith('장비 도착 0') : !!at;
            return (
              <li key={i} className="flex items-center gap-2">
                <span className={done ? 'text-emerald-600' : 'text-slate-300'}>{done ? '●' : '○'}</span>
                <span className={done ? 'text-slate-800 font-medium' : 'text-slate-400'}>{label}</span>
                {at && <span className="text-slate-400">· {fmtDateTime(at)}</span>}
              </li>
            );
          })}
        </ul>
      </section>

      {/* 장비 정보 (중장비·굴착) */}
      {(equipment.length > 0 || isHeavy || arrivals.length > 0) && (
        <section className="card text-sm space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-700">🚜 장비 정보 ({equipment.length})</h2>
            {isHeavy && arrivals.length === 0 && (
              <span className="rounded-full bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5">⚠ 장비 미등록</span>
            )}
          </div>
          {equipment.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {equipment.map((eq, i) => (
              <li key={i} className="py-1.5 flex items-center justify-between gap-2">
                <span className="text-slate-800"><b>{eq.type || '장비'}</b>{eq.vehicleNumber ? ` · ${eq.vehicleNumber}` : ' · 차량번호 현장 확인'}</span>
                {eq.vehicleNumber && (eq.matched
                  ? <span className="text-xs font-bold text-emerald-700 whitespace-nowrap shrink-0">✅ 교육차량 일치</span>
                  : <span className="text-xs font-bold text-red-600 whitespace-nowrap shrink-0">⚠ 차량번호 불일치 — 현장 확인 요망</span>)}
              </li>
            ))}
          </ul>
          )}
          {/* 장비 도착 기록(사진·시각) */}
          {arrivals.length > 0 && (
            <div>
              <p className="text-slate-400 text-xs mb-1">장비 도착 기록 ({arrivals.length})</p>
              <div className="flex gap-2 flex-wrap">
                {arrivals.map((a: any, i: number) => (
                  <div key={i} className="border border-slate-200 rounded p-1.5 w-36">
                    {a.photoUrl
                      ? <img src={a.photoUrl} alt={`장비 ${i + 1}`} onClick={() => setLightbox(a.photoUrl)} className="w-full h-20 object-cover rounded cursor-zoom-in hover:opacity-80" />
                      : <div className="w-full h-20 bg-slate-100 rounded flex items-center justify-center text-[10px] text-slate-400">사진 없음</div>}
                    <p className="text-[11px] text-slate-700 font-medium mt-1 truncate">{a.type}{a.vehicleNumber ? ` · ${a.vehicleNumber}` : ''}</p>
                    <p className="text-[10px] text-slate-400">도착 {fmtDateTime(a.at)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 현장 추가 등록 기록 — 무효 처리(정정)는 관리자만, 종료확인 후 불가 */}
          {additions.length > 0 && (
            <div>
              <p className="text-slate-400 text-xs mb-1">현장 추가 등록 ({additions.length})</p>
              <div className="flex gap-2 flex-wrap">
                {additions.map((f: any, i: number) => {
                  const who = f.actorType === 'ADMIN' ? '관리자' : '소장';
                  const what = [
                    (f.workers?.length ?? 0) > 0 ? `작업자 ${f.workers.length}명` : '',
                    (f.equipment?.length ?? 0) > 0 ? `장비 ${f.equipment.length}대` : '',
                  ].filter(Boolean).join('·');
                  return (
                    <div key={i} className={`border rounded p-1.5 w-40 ${f.void ? 'border-red-200 bg-red-50/40' : 'border-slate-200'}`}>
                      {f.photoUrl
                        ? <img src={f.photoUrl} alt={`현장 추가 ${i + 1}`} onClick={() => setLightbox(f.photoUrl)}
                            className={`w-full h-20 object-cover rounded cursor-zoom-in hover:opacity-80 ${f.void ? 'opacity-50' : ''}`} />
                        : <div className="w-full h-20 bg-slate-100 rounded flex items-center justify-center text-[10px] text-slate-400">사진 없음</div>}
                      <p className={`text-[11px] font-medium mt-1 ${f.void ? 'line-through text-slate-400' : 'text-slate-700'}`}>{what || '기록'}</p>
                      <p className={`text-[10px] ${f.void ? 'line-through text-slate-400' : 'text-slate-400'}`}>{fmtDateTime(f.at)} ({who})</p>
                      {f.void ? (
                        <p className="text-[10px] text-red-700 font-bold mt-1">【무효】 {f.void.reason}</p>
                      ) : hasApprove && !closed ? (
                        <button onClick={() => { setVoidModal({ index: i, label: `${fmtDateTime(f.at)} ${what}` }); setVoidReason(''); setVoidErr(''); }}
                          className="mt-1 text-[10px] font-bold text-red-600 hover:underline">무효 처리</button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* 참여자 3상태 */}
      <section className="card text-sm">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="font-bold text-slate-700 whitespace-nowrap">참여자 ({participants.length})</h2>
          <span className={`shrink-0 whitespace-nowrap text-[11px] rounded-full px-2 py-0.5 ${tbmStarted ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {tbmStarted ? 'TBM 진행/완료' : 'TBM 시작 전'}
          </span>
        </div>
        {/* 좁은 폭에서 표가 잘리지 않게 가로 스크롤 */}
        <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-xs min-w-[420px]">
          <thead>
            <tr className="text-slate-400 border-b border-slate-100">
              <th className="text-left py-1">성명</th><th className="text-left">소속</th>
              <th className="text-center">TBM 확인</th><th className="text-center">서약 서명</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p, i) => {
              const nm = (p.name ?? '').trim();
              const tbmOk = !!p.tbmSignature;
              const plOk = pledgeSigByName.get(nm) === true;
              return (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 font-medium text-slate-800">
                    {p.name}
                    {p.fieldJoinedAt && (
                      <span className="ml-1 rounded bg-sky-100 text-sky-700 text-[10px] font-bold px-1.5 py-0.5 whitespace-nowrap">현장 합류 {fmtDateTime(p.fieldJoinedAt).slice(-5)}</span>
                    )}
                  </td>
                  <td className="text-slate-500">{p.companyName}</td>
                  <td className="text-center"><TriCell done={tbmOk} started={tbmStarted} /></td>
                  <td className="text-center"><TriCell done={plOk} started={tbmStarted} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </section>

      {/* TBM 상세 — 실제 내용(사진·작업자 서명) 표시: "보고 승인" */}
      <section className="card text-sm space-y-3">
        <h2 className="font-bold text-slate-700">TBM 상세 <span className="text-[11px] font-normal text-slate-400">(2차 승인 전 확인)</span></h2>
        <ListRow k="위험요인" items={tbm.riskFactors} />
        <ListRow k="안전대책" items={tbm.safetyMeasures} />
        <Row k="안전관리자" v={tbm.safetyManager?.name} />
        <Row k="안전지시사항" v={tbm.safetyInstructions} />

        {/* 현장 사진 */}
        <div>
          <p className="text-slate-400 mb-1">현장 사진 ({photoCount})</p>
          {photoUrls.length > 0 ? (
            <div className="flex gap-2 flex-wrap">
              {photoUrls.map((u, i) => (
                <img key={i} src={u} alt={`TBM사진${i + 1}`} onClick={() => setLightbox(u)}
                  className="w-28 h-16 object-cover rounded border border-slate-200 cursor-zoom-in hover:opacity-80" />
              ))}
            </div>
          ) : (
            <p className="text-slate-300 text-xs">사진 없음</p>
          )}
        </div>

        {/* 작업자 TBM 서명 */}
        <div>
          <p className="text-slate-400 mb-1">작업자 TBM 서명 ({confirmedCount}/{participants.length})</p>
          <div className="flex flex-wrap gap-2">
            {participants.map((p, i) => {
              const nm = (p.name ?? '').trim();
              const s = p.tbmSignature;
              return (
                <div key={i} className="border border-slate-200 rounded p-1 w-24 text-center">
                  {s ? <img src={s} alt={`${nm} 서명`} className="h-8 mx-auto bg-white" />
                     : <div className="h-8 flex items-center justify-center text-[11px] text-amber-600 font-bold">미확인</div>}
                  <p className="text-[10px] text-slate-500 truncate mt-0.5">{p.name}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 서명 현황 + 1·2차 액션 */}
      <section className="card">
        <h2 className="font-bold text-slate-700 mb-1">승인 서명 (1·2차)</h2>
        <SigRow label="신청인" sub="TBM 팀장 겸용" signature={data.applicantSignature} who={info.applicantName} at={data.createdAt} />
        {/* 안전관리자(TBM 확인) — 업체 안전관리자 기능 미도입, 죽은 필드 대신 보류 표시 */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 py-2 border-b border-slate-100">
          <div className="sm:w-28 sm:shrink-0">
            <p className="text-sm font-semibold text-slate-700">안전관리자</p>
            <p className="text-[11px] text-slate-400">TBM 확인</p>
          </div>
          <span className="self-start rounded-full text-xs font-medium px-2 py-0.5 bg-slate-100 text-slate-400 cursor-help whitespace-nowrap" title="업체 안전관리자 기능 도입 시 사용 예정">보류</span>
        </div>
        <SigRow label="발급 (1차)" sub="안전환경" signature={data.issuer?.signature} who={slabel(data.issuer?.name)} at={data.issuer?.at}
          action={(hasApprove && !started && !isPast) || rbShow('issuer') ? (
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {hasApprove && !started && !isPast && btn(issuerSigned ? '재서명' : '1차 승인', () => { if (issuerSigned && !confirm('발급 서명을 다시 하면 덮어씁니다. 계속할까요?')) return; openModal({ type: 'issue' }); })}
              {rbShow('issuer') && rbBtn({ step: 'issuer', label: '1차 발급' })}
            </div>
          ) : null} />
        <SigRow label="입회 (2차)" sub="안전환경 현장입회" signature={witness?.signature} who={slabel(witness?.by)} at={witness?.at}
          action={(hasApprove && !started && !isPast) || rbShow('witness') ? (
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              {hasApprove && !started && !isPast && (
                !issuerSigned ? (
                  <span className="text-[11px] text-slate-400">1차 후 가능</span>
                ) : (witnessSigned || tbmComplete) ? (
                  btn(witnessSigned ? '재서명' : '2차 승인', startWitness)
                ) : (
                  <div className="text-right min-w-0">
                    <button disabled className="text-xs px-3 py-1.5 rounded-lg font-bold bg-slate-100 text-slate-400 cursor-not-allowed whitespace-nowrap">2차 승인</button>
                    <p className="text-[10px] text-amber-600 mt-0.5">{tbmReason}</p>
                  </div>
                )
              )}
              {rbShow('witness') && rbBtn({ step: 'witness', label: '2차 입회' })}
            </div>
          ) : null} />
      </section>

      {/* 3차 별지 현장확인 */}
      {checkedSupp.length > 0 && (
        <section className="card">
          <h2 className="font-bold text-slate-700 mb-1">별지 현장확인 (3차)</h2>
          <p className="text-[11px] text-slate-400 mb-2">별지마다 담당 확인부서가 개별 서명. 화기·정전=공무팀 / 그 외=안전환경.</p>
          {checkedSupp.map((w) => {
            const dept = SUPPLEMENTAL_CONFIRM_DEPT[w.key];
            const dc = deptConfs[w.key];
            const done = !!dc?.signature;
            const proxy = dc?.mode === 'EMERGENCY_PROXY';
            let action: React.ReactNode = null;
            if (!started && !isPast) {
              if (dept === '안전환경' && hasApprove) {
                action = btn(done ? '재확인' : '확인 서명', () => { if (done && !confirm('다시 확인하면 덮어씁니다.')) return; openModal({ type: 'dept', supKey: w.key, label: w.label, dept }); });
              } else if (dept === '공무') {
                if (hasDeptConfirm) {
                  action = btn(done ? '재확인' : '관련부서 확인', () => { if (done && !confirm('다시 확인하면 덮어씁니다.')) return; openModal({ type: 'dept', supKey: w.key, label: w.label, dept }); });
                } else if (isSuper) {
                  action = btn(done ? '재대리' : '긴급 대리확인', () => { if (done && !confirm('다시 대리확인하면 덮어씁니다.')) return; openModal({ type: 'proxy', supKey: w.key, label: w.label, dept }); }, 'warn');
                }
              }
            }
            return (
              <div key={w.key} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 py-2 border-b border-slate-100 last:border-0">
                <div className="sm:w-28 sm:shrink-0">
                  <p className="text-sm font-semibold text-slate-700">{w.label}</p>
                  <p className="text-[11px] text-slate-400">확인: {dept}</p>
                </div>
                <div className="flex items-center gap-2 min-w-0 flex-1 flex-wrap">
                  {done ? (
                    <>
                      <img src={dc.signature} alt="확인서명" className="h-9 border border-slate-200 rounded bg-white px-1 shrink-0" />
                      <div className="text-xs text-slate-600 min-w-0">
                        {proxy
                          ? <span className="text-amber-700 font-bold">긴급대리(안전환경)</span>
                          : (dc.name || slabel(dc.by))
                            ? <span className="font-medium truncate">{dc.name || slabel(dc.by)}</span>
                            : <span className="text-slate-400 italic whitespace-nowrap cursor-help" title="내 정보에서 부서·이름·직책을 등록하세요.">(정보 미등록)</span>}
                        {dc.at && <span className="text-slate-400 whitespace-nowrap"> · {fmtDateTime(dc.at)}</span>}
                        {proxy && dc.reason && <p className="text-[11px] text-amber-600">사유: {dc.reason}</p>}
                      </div>
                    </>
                  ) : (
                    <span className="rounded-full text-xs font-medium px-2 py-0.5 bg-amber-50 text-amber-700 whitespace-nowrap">대기</span>
                  )}
                </div>
                {(action || rbShow('dept', w.key)) && (
                  <div className="flex items-center gap-1.5 flex-wrap justify-end sm:shrink-0">
                    {action}
                    {rbShow('dept', w.key) && rbBtn({ step: 'dept', supKey: w.key, label: `${w.label} 별지 현장확인` })}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* 작업개시 게이트 */}
      <section className="card">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
          <div className="min-w-0">
            <h2 className="font-bold text-slate-700 whitespace-nowrap">작업 개시 승인</h2>
            {started
              ? <p className="text-xs text-emerald-600 mt-0.5 break-all">개시 승인됨{data.startedBy ? ` · ${data.startedBy}` : ''}{data.startedAt ? ` · ${fmtDateTime(data.startedAt)}` : ''}</p>
              : canStart
                ? <p className="text-xs text-slate-500 mt-0.5">모든 확인 완료 — 개시 가능</p>
                : <p className="text-xs text-amber-600 mt-0.5">차단: {startMissing.join(', ')} 미완료</p>}
          </div>
          {hasApprove && !started && !isPast && (
            <button onClick={startWork} disabled={!canStart}
              className={`shrink-0 self-start sm:self-auto whitespace-nowrap text-sm px-4 py-2 rounded-lg font-bold ${canStart ? 'bg-brand text-white hover:opacity-90' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
              작업 개시 승인
            </button>
          )}
        </div>
      </section>

      {/* 작업완료 (종료 2단계) */}
      <section className="card">
        <h2 className="font-bold text-slate-700 mb-1">작업완료 (종료 신고 → 확인)</h2>
        <SigRow label="종료 신고" sub="작업자/소장(대리입력)" signature={comp.workerSignature} who={slabel(comp.reportBy)} at={comp.reportAt}
          action={hasApprove && !closed ? btn(reportDone ? '재신고' : '종료 신고', () => {
            if (reportDone && !confirm('종료신고를 다시 하면 덮어씁니다.')) return;
            // 중장비인데 장비 도착 등록 0건 → 확인 문구만(차단 없음)
            if (isHeavy && arrivals.length === 0 && !confirm('장비 도착 등록 없이 종료합니다(크레인 미사용 등). 계속하시겠습니까?')) return;
            openModal({ type: 'report' });
          }) : null} />
        <SigRow label="종료 확인" sub="안전환경 최종" signature={comp.confirmSignature} who={slabel(comp.confirmBy)} at={comp.confirmAt}
          action={hasApprove && !closed ? (
            reportDone
              ? btn(confirmDone ? '재확인' : '종료 확인', () => openModal({ type: 'confirm' }))
              : <span className="text-[11px] text-slate-400">신고 후 가능</span>
          ) : null} />
        {comp.restoreState && <Row k="복원상태" v={comp.restoreState} />}
      </section>

      {/* 되돌리기 이력 */}
      {Array.isArray(data.rollbackLogs) && data.rollbackLogs.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer font-bold text-slate-700 text-sm select-none">
            ↩ 되돌리기 이력 {data.rollbackLogs.length}건
          </summary>
          <ul className="mt-3 space-y-2 text-xs">
            {data.rollbackLogs.map((l: any, i: number) => (
              <li key={i} className="border-b border-slate-100 pb-2 last:border-0">
                <span className="font-semibold text-red-600">{l.label || l.stage}</span>
                <span className="text-slate-500"> 취소</span>
                <span className="text-slate-400"> · {l.by || '-'} · {fmtDateTime(l.at)}</span>
                {l.reason && <p className="text-slate-600 mt-0.5">사유: {l.reason}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* 되돌리기 모달 */}
      {rbModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !rbSaving && setRbModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-red-700">↩ 이전 단계로 되돌리기</h3>
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-slate-700 space-y-1">
              <p><span className="font-bold text-red-700">{rbModal.label}</span> 단계를 취소합니다.</p>
              <p className="text-xs text-slate-600">해당 서명이 삭제되고, 취소 기록(사유 포함)이 영구 남습니다. 반려가 아니며 서류는 유지됩니다.</p>
            </div>
            <div>
              <label className="label">되돌리기 사유 <span className="text-red-500">*</span></label>
              <textarea className="input-base min-h-[72px]" placeholder="예: TBM 참여자 누락 발견 — 인원 추가 후 재승인" value={rbReason} onChange={(e) => setRbReason(e.target.value)} />
            </div>
            {rbErr && <p className="text-sm text-red-600">{rbErr}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button className="btn-secondary" onClick={() => setRbModal(null)} disabled={rbSaving}>취소</button>
              <button
                className="whitespace-nowrap text-sm px-5 py-2 rounded-lg font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                onClick={submitRollback} disabled={rbSaving}
              >{rbSaving ? '처리 중…' : '되돌리기'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 현장 추가 등록 무효 처리(정정) */}
      {voidModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !voidSaving && setVoidModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-red-700">🚫 현장 추가 등록 무효 처리</h3>
            <p className="text-sm text-slate-600">{voidModal.label}</p>
            <p className="text-xs text-slate-500">
              기록은 <b>삭제되지 않습니다</b>. 원본은 그대로 남고 취소선과 함께 무효 사유·처리자·시각이 출력물에 표시됩니다.
              올바른 내용은 현장에서 <b>새로 등록</b>해 주세요.
            </p>
            <div>
              <label className="label">무효 사유 <span className="text-red-500">*</span></label>
              <input className="input-base" value={voidReason} onChange={(e) => setVoidReason(e.target.value)}
                placeholder="예: 장비 종류를 잘못 입력함" />
            </div>
            {voidErr && <p className="text-sm text-red-600">{voidErr}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-secondary" onClick={() => setVoidModal(null)} disabled={voidSaving}>취소</button>
              <button
                className="whitespace-nowrap text-sm px-5 py-2 rounded-lg font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                onClick={submitVoid} disabled={voidSaving}
              >{voidSaving ? '처리 중…' : '무효 처리'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 모달 */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !saving && setModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800">
              {modal.type === 'issue' && '1차 승인 — 발급자 서명 (안전환경)'}
              {modal.type === 'witness' && '2차 승인 — 입회자 서명 (안전환경)'}
              {modal.type === 'dept' && `별지 현장확인 — ${modal.label} (${modal.dept})`}
              {modal.type === 'proxy' && `긴급 대리확인 — ${modal.label} (공무 미배정)`}
              {modal.type === 'report' && '종료 신고 — 작업자/소장 서명'}
              {modal.type === 'confirm' && '종료 확인 — 안전환경 최종 서명'}
            </h3>

            {modal.type === 'issue' && (
              <div><label className="label">직책 (선택)</label>
                <input className="input-base" placeholder="예: 안전환경담당" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            )}
            {modal.type === 'issue' && equipment.length > 0 && (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-2 text-xs space-y-0.5">
                <p className="font-bold text-slate-600">🚜 장비 정보 (승인 전 확인)</p>
                {equipment.map((eq, i) => (
                  <p key={i} className={eq.vehicleNumber && !eq.matched ? 'text-red-600 font-bold' : 'text-slate-700'}>
                    · {eq.type || '장비'}{eq.vehicleNumber ? ` · ${eq.vehicleNumber}` : ''}{eq.vehicleNumber ? (eq.matched ? ' ✅' : ' ⚠ 불일치·현장확인') : ''}
                  </p>
                ))}
              </div>
            )}
            {modal.type === 'witness' && (
              <div><label className="label">오늘의 안전지시사항 <span className="text-red-500">*</span></label>
                <textarea className="input-base min-h-[72px]" placeholder="현장 TBM 후 안전지시사항" value={instructions} onChange={(e) => setInstructions(e.target.value)} /></div>
            )}
            {modal.type === 'proxy' && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 space-y-1">
                <label className="label text-amber-800">긴급 대리확인 사유 <span className="text-red-500">*</span></label>
                <textarea className="input-base min-h-[64px]" placeholder="공무 계정 미배정 사유 등" value={reason} onChange={(e) => setReason(e.target.value)} />
                <p className="text-[11px] text-amber-700">※ 출력물에 "공무 미배정 · 안전환경 긴급대리(사유)"로 표기됩니다. 공무 서명이 아닙니다.</p>
              </div>
            )}
            {modal.type === 'report' && (
              <>
                <div><label className="label">완료시간 (미입력 시 현재시각)</label>
                  <input type="datetime-local" className="input-base" value={completedAt} onChange={(e) => setCompletedAt(e.target.value)} /></div>
                <div><label className="label">복원(조치)상태</label>
                  <textarea className="input-base min-h-[56px]" placeholder="원상복구·잔여위험 등" value={restoreState} onChange={(e) => setRestoreState(e.target.value)} /></div>
              </>
            )}

            <div>
              <label className="label">서명</label>
              <SignaturePad onChange={setSig} />
            </div>
            {modalErr && <p className="text-sm text-red-600">{modalErr}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button className="btn-secondary" onClick={() => setModal(null)} disabled={saving}>취소</button>
              <button className="btn-primary" onClick={submitSig} disabled={saving}>{saving ? '저장 중…' : '서명 저장'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 사진 라이트박스 */}
      {lightbox && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="사진 확대" className="max-h-full max-w-full rounded" />
        </div>
      )}
    </main>
  );
}

function ListRow({ k, items }: { k: string; items?: string[] | null }) {
  const arr = (items ?? []).filter((x) => x && String(x).trim());
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-slate-400">{k}</span>
      {arr.length > 0 ? (
        <ul className="list-disc pl-4 text-slate-800 space-y-0.5">{arr.map((x, i) => <li key={i}>{x}</li>)}</ul>
      ) : (
        <span className="text-slate-800">-</span>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string | null }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-24 shrink-0 text-slate-400">{k}</span>
      <span className="text-slate-800 whitespace-pre-wrap">{v || '-'}</span>
    </div>
  );
}
