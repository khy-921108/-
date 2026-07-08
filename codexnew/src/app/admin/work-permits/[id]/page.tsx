'use client';

/**
 * 관리자 작업허가서 상세 — R-6 게이트③-2a
 * ③-1(조회) + 1차 발급·2차 입회 서명 캡처. 단계별 개별 액션(일괄 금지), 1차→2차 순서 강제.
 * ⚠️ 3차 별지 현장확인·공무 부서확인·작업완료 서명은 ③-2b(미구현). 여기선 상태만 표시.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import SignaturePad from '@/components/SignaturePad';
import { SUPPLEMENTAL_WORKS } from '@/lib/work-permit-constants';

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '-';
  const k = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}.${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

interface Conf { name: string; signature?: string; confirmedAt?: string }

function StatusBadge({ status }: { status: string }) {
  const m: Record<string, { l: string; c: string }> = {
    APPROVED: { l: '✅ 승인', c: 'bg-emerald-100 text-emerald-700' },
    REJECTED: { l: '⛔ 반려', c: 'bg-red-100 text-red-700' },
    SUBMITTED: { l: '⏳ 대기', c: 'bg-slate-100 text-slate-600' },
  };
  const s = m[status] ?? m.SUBMITTED;
  return <span className={`rounded-full text-xs font-bold px-2.5 py-1 ${s.c}`}>{s.l}</span>;
}

/** 3상태 셀: TBM 전(회색) / 미완료(주황) / 완료(✅) */
function TriCell({ done, started }: { done: boolean; started: boolean }) {
  if (done) return <span className="text-emerald-600 font-bold">✅</span>;
  if (started) return <span className="rounded bg-amber-100 text-amber-700 text-[11px] font-bold px-1.5 py-0.5">미완료</span>;
  return <span className="text-slate-300 text-[11px]">TBM 전</span>;
}

/** 서명 현황 한 줄 (+ 우측 액션 슬롯) */
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 서명 모달
  const [modal, setModal] = useState<null | 'issue' | 'witness'>(null);
  const [sig, setSig] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [modalErr, setModalErr] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/work-permits/${id}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) setData(json.data);
      else setError(json.message || '조회 실패');
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
  const confs: Conf[] = Object.values(tbm.confirmations ?? {});
  const confByName = new Map(confs.map((c) => [(c.name ?? '').trim(), c]));
  const pledgeSigByName = new Map<string, boolean>(
    (data.docs?.pledges ?? []).map((p: any) => [(p.name ?? '').trim(), !!p.signature])
  );
  const checkedSupp = SUPPLEMENTAL_WORKS.filter((w) => data.supplemental?.[w.key] === 'Y');
  const participants: any[] = data.participants ?? [];
  const photoCount = Array.isArray(tbm.photos) ? tbm.photos.length : 0;

  // TBM 시작 판정: 사진 또는 안전지시사항 중 하나라도 있으면 시작됨
  const tbmStarted = photoCount > 0 || !!(tbm.safetyInstructions && String(tbm.safetyInstructions).trim());

  const issuerSigned = !!(data.issuer?.signature && String(data.issuer.signature).startsWith('data:image/'));
  const witness = tbm.witness ?? null;
  const witnessSigned = !!(witness?.signature && String(witness.signature).startsWith('data:image/'));

  const openModal = (kind: 'issue' | 'witness') => {
    setModalErr('');
    setSig('');
    setTitle('');
    setInstructions(tbm.safetyInstructions ?? '');
    setModal(kind);
  };

  const submitSig = async () => {
    if (!sig) { setModalErr('서명을 입력해 주세요.'); return; }
    if (modal === 'witness' && !instructions.trim()) { setModalErr('오늘의 안전지시사항을 입력해 주세요.'); return; }
    setSaving(true);
    setModalErr('');
    try {
      const bodyObj: any = { action: modal, signature: sig };
      if (modal === 'issue') bodyObj.title = title.trim();
      if (modal === 'witness') bodyObj.safetyInstructions = instructions.trim();
      const res = await fetch(`/api/admin/work-permits/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj),
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

  const IssueBtn = (
    <button
      onClick={() => { if (issuerSigned && !confirm('이미 발급 서명이 있습니다. 다시 서명하면 덮어씁니다. 계속할까요?')) return; openModal('issue'); }}
      className="btn-primary text-xs px-3 py-1.5"
    >
      {issuerSigned ? '재서명' : '1차 승인'}
    </button>
  );
  const WitnessBtn = (
    <button
      onClick={() => {
        if (!issuerSigned) return;
        if (witnessSigned && !confirm('이미 입회 서명이 있습니다. 다시 서명하면 덮어씁니다. 계속할까요?')) return;
        openModal('witness');
      }}
      disabled={!issuerSigned}
      title={!issuerSigned ? '1차 승인(발급)을 먼저 완료하세요' : undefined}
      className={`text-xs px-3 py-1.5 rounded-lg font-bold ${issuerSigned ? 'btn-primary' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
    >
      {witnessSigned ? '재서명' : '2차 승인'}
    </button>
  );

  return (
    <main className="space-y-5">
      {/* 헤더 — 허가번호 크게 */}
      <div className="card">
        <a href="/admin/work-permits" className="text-xs text-slate-500 hover:underline">← 작업허가 목록</a>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-1">
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xl sm:text-3xl font-extrabold tracking-tight text-brand whitespace-nowrap">{data.permitNumber}</span>
            <StatusBadge status={data.status} />
          </div>
          <div className="flex gap-2">
            <a href={`/work-permit/print/${id}`} target="_blank" rel="noreferrer" className="btn-secondary text-sm">🖨 인쇄</a>
            <a href={`/api/work-permits/${id}/xlsx`} className="btn-secondary text-sm">📥 회사양식 xlsx</a>
          </div>
        </div>
        <p className="text-sm text-slate-600 mt-2">{info.workName} · {data.companyName}</p>
      </div>

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

      {/* 보충작업 별지 */}
      <section className="card text-sm">
        <h2 className="font-bold text-slate-700 mb-2">보충작업 별지 ({checkedSupp.length})</h2>
        {checkedSupp.length === 0 ? (
          <p className="text-slate-400">해당 없음 (일반위험작업만)</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {checkedSupp.map((w) => (
              <span key={w.key} className="rounded-full bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5">{w.label}</span>
            ))}
          </div>
        )}
      </section>

      {/* 참여자 명단 + TBM 확인 / 서약 서명 (3상태) */}
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
              <th className="text-left py-1">성명</th>
              <th className="text-left">소속</th>
              <th className="text-center">TBM 확인</th>
              <th className="text-center">서약 서명</th>
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

      {/* TBM 상세 */}
      <section className="card text-sm space-y-1.5">
        <h2 className="font-bold text-slate-700 mb-2">TBM 상세</h2>
        <Row k="위험요인" v={(tbm.riskFactors ?? []).join(', ')} />
        <Row k="안전대책" v={(tbm.safetyMeasures ?? []).join(', ')} />
        <Row k="안전관리자" v={tbm.safetyManager?.name} />
        <Row k="현장사진" v={photoCount > 0 ? `${photoCount}장 첨부` : '없음'} />
        <Row k="안전지시사항" v={tbm.safetyInstructions} />
        <Row k="참석 확인" v={`${confs.filter((c) => c.signature).length} / ${participants.length}명`} />
      </section>

      {/* 서명 현황 + 액션 (핵심) */}
      <section className="card">
        <h2 className="font-bold text-slate-700 mb-1">서명 현황 / 승인</h2>
        <p className="text-[11px] text-slate-400 mb-2">발급(1차) → 입회(2차) 순서. 요청부서 승인·별지 현장확인·작업완료 서명은 ③-2b에서 추가됩니다.</p>
        <SigRow label="신청인" sub="TBM 팀장 겸용" signature={data.applicantSignature} who={info.applicantName} at={data.createdAt} />
        <SigRow label="안전관리자" sub="TBM 확인" signature={tbm.safetyManager?.signature} who={tbm.safetyManager?.name} />
        <SigRow label="발급 (1차)" sub="안전환경" signature={data.issuer?.signature} who={data.issuer?.name} at={data.issuer?.at} action={IssueBtn} />
        <SigRow label="입회 (2차)" sub="안전환경 현장입회" signature={witness?.signature} who={witness?.by} at={witness?.at} action={WitnessBtn} />
        <SigRow label="승인 (요청부서)" sub="현장책임자" signature={data.approval?.signature} who={data.approval?.name} at={data.approval?.at} pending="③-2b 예정" />
        <SigRow label="작업완료" sub="작업자 서명" signature={data.completion?.workerSignature} who={info.applicantName} at={data.completion?.completedAt} pending="③-2b 예정" />
        {checkedSupp.length > 0 && (
          <SigRow label="별지 현장확인" sub={checkedSupp.map((w) => w.label).join('·')} signature={null} pending="③-2b 예정" />
        )}
      </section>

      {/* 서명 모달 */}
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !saving && setModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800">
              {modal === 'issue' ? '1차 승인 — 발급자 서명 (안전환경)' : '2차 승인 — 입회자 서명 (안전환경)'}
            </h3>

            {modal === 'issue' && (
              <div>
                <label className="label">직책 (선택)</label>
                <input className="input-base" placeholder="예: 안전환경담당" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
            )}

            {modal === 'witness' && (
              <div>
                <label className="label">오늘의 안전지시사항 <span className="text-red-500">*</span></label>
                <textarea
                  className="input-base min-h-[72px]"
                  placeholder="현장 TBM 후 오늘 작업에 대한 안전지시사항을 입력하세요."
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                />
              </div>
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
    </main>
  );
}

function Row({ k, v }: { k: string; v?: string | null }) {
  return (
    <div className="flex gap-2">
      <span className="w-24 shrink-0 text-slate-400">{k}</span>
      <span className="text-slate-800 whitespace-pre-wrap">{v || '-'}</span>
    </div>
  );
}
