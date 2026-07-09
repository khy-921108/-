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
  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
      <div className="w-28 shrink-0">
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
      </div>
      {signed ? (
        <>
          <img src={signature!} alt="서명" className="h-9 border border-slate-200 rounded bg-white px-1" />
          <div className="text-xs text-slate-600 min-w-0">
            {who && <span className="font-medium break-all">{who}</span>}
            {at && <span className="text-slate-400"> · {fmtDateTime(at)}</span>}
          </div>
        </>
      ) : (
        <span className={`rounded-full text-xs font-medium px-2 py-0.5 ${pending ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
          {pending ?? '미서명'}
        </span>
      )}
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}

export default function AdminWorkPermitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [me, setMe] = useState<{ role: string; permissions: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');

  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [witnessWarn, setWitnessWarn] = useState(false);

  const [modal, setModal] = useState<ModalState>(null);
  const [sig, setSig] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [reason, setReason] = useState('');
  const [restoreState, setRestoreState] = useState('');
  const [completedAt, setCompletedAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [modalErr, setModalErr] = useState('');

  const load = useCallback(async () => {
    try {
      const [pRes, mRes, phRes] = await Promise.all([
        fetch(`/api/work-permits/${id}`, { cache: 'no-store' }),
        fetch(`/api/admin/me`, { cache: 'no-store' }),
        fetch(`/api/admin/work-permits/${id}/tbm-photos`, { cache: 'no-store' }),
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
  const tbm = data.tbm ?? {};
  const comp = data.completion ?? {};
  const deptConfs: Record<string, any> = data.deptConfirmations ?? {};
  const confs: Conf[] = Object.values(tbm.confirmations ?? {});
  const confByName = new Map(confs.map((c) => [(c.name ?? '').trim(), c]));
  const pledgeSigByName = new Map<string, boolean>(
    (data.docs?.pledges ?? []).map((p: any) => [(p.name ?? '').trim(), !!p.signature])
  );
  const checkedSupp = SUPPLEMENTAL_WORKS.filter((w) => data.supplemental?.[w.key] === 'Y');
  const participants: any[] = data.participants ?? [];
  const photoCount = Array.isArray(tbm.photos) ? tbm.photos.length : 0;
  const tbmStarted = photoCount > 0 || !!(tbm.safetyInstructions && String(tbm.safetyInstructions).trim());
  const confirmedCount = confs.filter((c) => c.signature).length;
  const tbmHasContent = photoCount > 0 || confirmedCount > 0; // ③-2c: 2차 경고 판단(사진 또는 작업자 서명)

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

  const resetFields = () => { setSig(''); setTitle(''); setInstructions(tbm.safetyInstructions ?? ''); setReason(''); setRestoreState(comp.restoreState ?? ''); setCompletedAt(''); setModalErr(''); };
  const openModal = (m: ModalState) => { resetFields(); setModal(m); };

  // 2차 승인 진입 — TBM(사진·작업자 서명) 없으면 경고 후 진행(게이트 잠금 아님)
  const startWitness = () => {
    if (witnessSigned && !confirm('입회 서명을 다시 하면 덮어씁니다. 계속할까요?')) return;
    if (!tbmHasContent) { setWitnessWarn(true); return; }
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
      const res = await fetch(`/api/admin/work-permits/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
      });
      const json = await res.json();
      if (!json.success) { setModalErr(json.message || '저장 실패'); setSaving(false); return; }
      setModal(null);
      await load();
    } catch {
      setModalErr('네트워크 오류');
    } finally {
      setSaving(false);
    }
  };

  const startWork = async () => {
    setBanner('');
    try {
      const res = await fetch(`/api/admin/work-permits/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start_work' }),
      });
      const json = await res.json();
      if (!json.success) { setBanner(`⛔ ${json.message}`); return; }
      await load();
    } catch { setBanner('네트워크 오류'); }
  };

  const btn = (label: string, on: () => void, kind: 'primary' | 'warn' = 'primary') => (
    <button onClick={on} className={`text-xs px-3 py-1.5 rounded-lg font-bold ${kind === 'warn' ? 'bg-amber-500 text-white hover:bg-amber-600' : 'btn-primary'}`}>{label}</button>
  );

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
          <div className="flex gap-2">
            <a href={`/work-permit/print/${id}`} target="_blank" rel="noreferrer" className="btn-secondary text-sm">🖨 인쇄</a>
            <a href={`/api/work-permits/${id}/xlsx`} className="btn-secondary text-sm">📥 회사양식 xlsx</a>
          </div>
        </div>
        <p className="text-sm text-slate-600 mt-2">{info.workName} · {data.companyName}</p>
      </div>

      {banner && <div className="card bg-red-50 border border-red-200 text-red-700 text-sm">{banner}</div>}

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

      {/* 참여자 3상태 */}
      <section className="card text-sm">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-slate-700">참여자 ({participants.length})</h2>
          <span className={`text-[11px] rounded-full px-2 py-0.5 ${tbmStarted ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {tbmStarted ? 'TBM 진행/완료' : 'TBM 시작 전'}
          </span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400 border-b border-slate-100">
              <th className="text-left py-1">성명</th><th className="text-left">소속</th>
              <th className="text-center">TBM 확인</th><th className="text-center">서약 서명</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p, i) => {
              const nm = (p.name ?? '').trim();
              const tbmOk = confByName.has(nm) && !!confByName.get(nm)?.signature;
              const plOk = pledgeSigByName.get(nm) === true;
              return (
                <tr key={i} className="border-b border-slate-50">
                  <td className="py-1.5 font-medium text-slate-800">{p.name}</td>
                  <td className="text-slate-500">{p.companyName}</td>
                  <td className="text-center"><TriCell done={tbmOk} started={tbmStarted} /></td>
                  <td className="text-center"><TriCell done={plOk} started={tbmStarted} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
              const c = confByName.get(nm);
              const s = c?.signature;
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
        <SigRow label="안전관리자" sub="TBM 확인" signature={tbm.safetyManager?.signature} who={tbm.safetyManager?.name} />
        <SigRow label="발급 (1차)" sub="안전환경" signature={data.issuer?.signature} who={data.issuer?.name} at={data.issuer?.at}
          action={hasApprove && !started ? btn(issuerSigned ? '재서명' : '1차 승인', () => { if (issuerSigned && !confirm('발급 서명을 다시 하면 덮어씁니다. 계속할까요?')) return; openModal({ type: 'issue' }); }) : null} />
        <SigRow label="입회 (2차)" sub="안전환경 현장입회" signature={witness?.signature} who={witness?.by} at={witness?.at}
          action={hasApprove && !started ? (
            issuerSigned
              ? btn(witnessSigned ? '재서명' : '2차 승인', startWitness)
              : <span className="text-[11px] text-slate-400">1차 후 가능</span>
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
            if (!started) {
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
              <div key={w.key} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                <div className="w-28 shrink-0">
                  <p className="text-sm font-semibold text-slate-700">{w.label}</p>
                  <p className="text-[11px] text-slate-400">확인: {dept}</p>
                </div>
                {done ? (
                  <>
                    <img src={dc.signature} alt="확인서명" className="h-9 border border-slate-200 rounded bg-white px-1" />
                    <div className="text-xs text-slate-600 min-w-0">
                      {proxy
                        ? <span className="text-amber-700 font-bold">긴급대리(안전환경)</span>
                        : <span className="font-medium break-all">{dc.name || dc.by}</span>}
                      {dc.at && <span className="text-slate-400"> · {fmtDateTime(dc.at)}</span>}
                      {proxy && dc.reason && <p className="text-[11px] text-amber-600">사유: {dc.reason}</p>}
                    </div>
                  </>
                ) : (
                  <span className="rounded-full text-xs font-medium px-2 py-0.5 bg-amber-50 text-amber-700">대기</span>
                )}
                {action && <div className="ml-auto shrink-0">{action}</div>}
              </div>
            );
          })}
        </section>
      )}

      {/* 작업개시 게이트 */}
      <section className="card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-700">작업 개시 승인</h2>
            {started
              ? <p className="text-xs text-emerald-600 mt-0.5">개시 승인됨{data.startedBy ? ` · ${data.startedBy}` : ''}{data.startedAt ? ` · ${fmtDateTime(data.startedAt)}` : ''}</p>
              : canStart
                ? <p className="text-xs text-slate-500 mt-0.5">모든 확인 완료 — 개시 가능</p>
                : <p className="text-xs text-amber-600 mt-0.5">차단: {startMissing.join(', ')} 미완료</p>}
          </div>
          {hasApprove && !started && (
            <button onClick={startWork} disabled={!canStart}
              className={`text-sm px-4 py-2 rounded-lg font-bold ${canStart ? 'btn-primary' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
              작업 개시 승인
            </button>
          )}
        </div>
      </section>

      {/* 작업완료 (종료 2단계) */}
      <section className="card">
        <h2 className="font-bold text-slate-700 mb-1">작업완료 (종료 신고 → 확인)</h2>
        <SigRow label="종료 신고" sub="작업자/소장(대리입력)" signature={comp.workerSignature} who={comp.reportBy} at={comp.reportAt}
          action={hasApprove && !closed ? btn(reportDone ? '재신고' : '종료 신고', () => { if (reportDone && !confirm('종료신고를 다시 하면 덮어씁니다.')) return; openModal({ type: 'report' }); }) : null} />
        <SigRow label="종료 확인" sub="안전환경 최종" signature={comp.confirmSignature} who={comp.confirmBy} at={comp.confirmAt}
          action={hasApprove && !closed ? (
            reportDone
              ? btn(confirmDone ? '재확인' : '종료 확인', () => openModal({ type: 'confirm' }))
              : <span className="text-[11px] text-slate-400">신고 후 가능</span>
          ) : null} />
        {comp.restoreState && <Row k="복원상태" v={comp.restoreState} />}
      </section>

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

            <div><label className="label">서명</label><SignaturePad onChange={setSig} /></div>
            {modalErr && <p className="text-sm text-red-600">{modalErr}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button className="btn-secondary" onClick={() => setModal(null)} disabled={saving}>취소</button>
              <button className="btn-primary" onClick={submitSig} disabled={saving}>{saving ? '저장 중…' : '서명 저장'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 2차 TBM 미완료 경고 */}
      {witnessWarn && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setWitnessWarn(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-amber-700">⚠️ TBM 미완료</h3>
            <p className="text-sm text-slate-600">TBM 현장 사진·작업자 서명이 하나도 없습니다. 현장 TBM을 확인하고 서명하시겠습니까?</p>
            <div className="flex gap-2 justify-end pt-1">
              <button className="btn-secondary" onClick={() => setWitnessWarn(false)}>취소</button>
              <button className="btn-primary" onClick={() => { setWitnessWarn(false); openModal({ type: 'witness' }); }}>확인하고 진행</button>
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
