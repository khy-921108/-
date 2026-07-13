'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { readDraft, type WpParticipant } from '@/lib/work-permit-draft';
import {
  PLEDGE_INTRO,
  PLEDGE_CLAUSES,
  UNDERTAKING_INTRO,
  UNDERTAKING_CLAUSES,
} from '@/lib/work-permit-constants';
import SignaturePad from '@/components/SignaturePad';

interface PledgeStatus {
  name: string;
  status: 'VALID' | 'MISSING';
  expiresAt: string | null;
  saved: { nationality: string | null; bloodType: string | null; jobType: string | null } | null;
}
interface UndertakingStatus {
  status: 'VALID' | 'STALE_MEMBERS' | 'MISSING';
  expiresAt: string | null;
  workArea: string | null;
  managerName: string | null;
  managerPhone: string | null;
  memberCount: number;
  missingMembers: string[];
}

const NATIONALITIES = ['한국', '中国', 'Việt Nam', '기타'];
const BLOOD_TYPES = ['A형', 'B형', 'O형', 'AB형'];

export default function WorkPermitDocs() {
  const router = useRouter();
  const [companyId, setCompanyId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [workEnd, setWorkEnd] = useState('');
  const [participants, setParticipants] = useState<WpParticipant[]>([]);

  const [pledges, setPledges] = useState<PledgeStatus[]>([]);
  const [undertaking, setUndertaking] = useState<UndertakingStatus | null>(null);
  const [allValid, setAllValid] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 개인서약 인라인 입력 (참여자 index별)
  const [pForm, setPForm] = useState<Record<number, { nationality: string; bloodType: string; jobType: string }>>({});
  const [pBusy, setPBusy] = useState<Record<number, boolean>>({});
  const [pConfirm, setPConfirm] = useState<Record<number, boolean>>({});
  const [pSig, setPSig] = useState<Record<number, string>>({}); // 서약자 디지털 서명(base64) // 서약 내용 확인 동의

  // 이행각서 인라인 입력
  const [uManager, setUManager] = useState('');
  const [uPhone, setUPhone] = useState('');
  const [uArea, setUArea] = useState('');
  const [uBusy, setUBusy] = useState(false);
  const [uConfirm, setUConfirm] = useState(false); // 각서 내용 확인 동의

  const loadStatus = useCallback(async (cid: string, we: string, ps: WpParticipant[]) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/safety-docs/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: cid,
          workEnd: we,
          participants: ps.map((p) => ({ name: p.name, birthDate: p.birthDate, phone: p.phone })),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message || '필수서류 확인에 실패했습니다.');
        return;
      }
      setPledges(json.data.pledges);
      setUndertaking(json.data.undertaking);
      setAllValid(json.data.allValid);
      // 미보유 개인서약 폼 프리필
      setPForm((prev) => {
        const next = { ...prev };
        json.data.pledges.forEach((pl: PledgeStatus, i: number) => {
          if (pl.status !== 'VALID' && !next[i]) {
            next[i] = {
              nationality: pl.saved?.nationality ?? '한국',
              bloodType: pl.saved?.bloodType ?? 'A형',
              jobType: pl.saved?.jobType ?? '',
            };
          }
        });
        return next;
      });
      // 이행각서 프리필
      if (json.data.undertaking?.status !== 'VALID') {
        setUManager((m) => m || json.data.undertaking?.managerName || '');
        setUArea((a) => a || json.data.undertaking?.workArea || '');
      }
    } catch (e) {
      console.error(e);
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const d = readDraft();
    if (!d.company || !d.applicant || !d.info || !(d.participants && d.participants.length > 0)) {
      router.replace('/work-permit');
      return;
    }
    setCompanyId(d.company.id);
    setCompanyName(d.company.name);
    setWorkEnd(d.info.workEnd);
    setParticipants(d.participants);
    loadStatus(d.company.id, d.info.workEnd, d.participants);
  }, [router, loadStatus]);

  const issuePledge = async (i: number) => {
    const p = participants[i];
    const form = pForm[i];
    if (!form?.nationality || !form?.bloodType || !form?.jobType.trim()) {
      setError(`${p.name} 님의 국적·혈액형·직종을 모두 입력해 주세요.`);
      return;
    }
    if (!pConfirm[i]) {
      setError(`${p.name} 님의 안전준수 서약 내용 확인에 동의해 주세요.`);
      return;
    }
    // 🔴 서명 필수 — 서명 없이는 발급 불가.
    if (!pSig[i]) {
      setError(`${p.name} 님의 본인 서명을 입력해 주세요.`);
      return;
    }
    setPBusy((b) => ({ ...b, [i]: true }));
    setError('');
    try {
      const res = await fetch('/api/safety-pledges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: p.name, birthDate: p.birthDate, phone: p.phone, companyId,
          nationality: form.nationality, bloodType: form.bloodType, jobType: form.jobType.trim(),
          signature: pSig[i],
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message || '서약서 발급 실패');
        return;
      }
      await loadStatus(companyId, workEnd, participants);
    } catch (e) {
      console.error(e);
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setPBusy((b) => ({ ...b, [i]: false }));
    }
  };

  const issueUndertaking = async () => {
    if (!uManager.trim()) {
      setError('관리감독자명을 입력해 주세요.');
      return;
    }
    if (!uConfirm) {
      setError('이행각서 내용 확인에 동의해 주세요.');
      return;
    }
    setUBusy(true);
    setError('');
    try {
      const res = await fetch('/api/company-undertakings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          workArea: uArea.trim(),
          managerName: uManager.trim(),
          managerPhone: uPhone.trim(),
          members: participants.map((p) => ({ name: p.name, birthDate: p.birthDate, phone: p.phone })),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message || '이행각서 발급 실패');
        return;
      }
      await loadStatus(companyId, workEnd, participants);
    } catch (e) {
      console.error(e);
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setUBusy(false);
    }
  };

  const formatPhone = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 11);

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-brand">STEP 4 / 5</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">필수서류 확인</h1>
        <p className="mt-1 text-sm text-slate-500">
          개인 안전준수 서약(참여자별) + 업체 안전작업 이행각서는 <b>6개월 유효</b>합니다. 미보유 시 작성하면 발급됩니다.
        </p>
        <p className="mt-1 text-xs text-slate-400">※ 개인서약은 <b>본인 서명</b>을 해야 발급됩니다. 각 참여자가 직접 서명해 주세요.</p>
      </header>

      {loading ? (
        <div className="card text-center text-slate-500 py-6">확인 중...</div>
      ) : (
        <>
          {/* 개인서약 */}
          <section className="space-y-2">
            <h2 className="text-sm font-bold text-slate-700">① 개인 안전준수 서약 (참여자별)</h2>
            {participants.map((p, i) => {
              const pl = pledges[i];
              const valid = pl?.status === 'VALID';
              const form = pForm[i] ?? { nationality: '한국', bloodType: 'A형', jobType: '' };
              return (
                <div key={i} className="card space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-slate-800">{p.name} <span className="text-xs font-normal text-slate-500">{p.companyName ?? ''}</span></p>
                    {valid ? (
                      <span className="text-xs font-bold text-emerald-700">✓ 유효 (~{pl.expiresAt?.substring(0, 10)})</span>
                    ) : (
                      <span className="text-xs font-bold text-amber-700">작성 필요</span>
                    )}
                  </div>
                  {!valid && (
                    <div className="space-y-2 pt-1">
                      <div>
                        <label className="label">국적</label>
                        <select
                          className="input-base"
                          value={form.nationality}
                          onChange={(e) => setPForm((f) => ({ ...f, [i]: { ...form, nationality: e.target.value } }))}
                        >
                          {NATIONALITIES.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">혈액형</label>
                        <select
                          className="input-base"
                          value={form.bloodType}
                          onChange={(e) => setPForm((f) => ({ ...f, [i]: { ...form, bloodType: e.target.value } }))}
                        >
                          {BLOOD_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">직종</label>
                        <input
                          className="input-base"
                          value={form.jobType}
                          onChange={(e) => setPForm((f) => ({ ...f, [i]: { ...form, jobType: e.target.value } }))}
                          placeholder="예: 배관, 용접, 전기"
                        />
                      </div>
                      <div>
                        <label className="label">안전준수 서약 내용 (아래로 스크롤하여 확인)</label>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 max-h-48 overflow-y-auto text-xs leading-relaxed text-slate-700">
                          <p className="mb-2">{PLEDGE_INTRO}</p>
                          <ol className="list-decimal pl-4 space-y-1">
                            {PLEDGE_CLAUSES.map((c, ci) => <li key={ci}>{c}</li>)}
                          </ol>
                        </div>
                        <label className="mt-2 flex items-start gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={!!pConfirm[i]}
                            onChange={(e) => setPConfirm((c) => ({ ...c, [i]: e.target.checked }))}
                          />
                          <span>위 안전준수 서약 내용을 모두 확인하였으며 이에 동의합니다.</span>
                        </label>
                      </div>
                      <div>
                        <label className="label">본인 서명 <span className="text-red-500">*</span></label>
                        <SignaturePad onChange={(d) => setPSig((s) => ({ ...s, [i]: d }))} />
                        <p className="mt-1 text-xs text-slate-500">※ 본인이 직접 서명해야 서약서가 발급됩니다.</p>
                      </div>
                      <button type="button" onClick={() => issuePledge(i)} disabled={pBusy[i] || !pConfirm[i] || !pSig[i]} className="btn-primary">
                        {pBusy[i] ? '발급 중...' : '확인·서명 완료 · 서약서 발급'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          {/* 이행각서 */}
          <section className="space-y-2">
            <h2 className="text-sm font-bold text-slate-700">② 업체 안전작업 이행각서 ({companyName})</h2>
            <div className="card space-y-2">
              {undertaking?.status === 'VALID' ? (
                <p className="text-xs font-bold text-emerald-700">✓ 유효 (~{undertaking.expiresAt?.substring(0, 10)}) · 커버 인원 {undertaking.memberCount}명</p>
              ) : (
                <>
                  {undertaking?.status === 'STALE_MEMBERS' && (
                    <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
                      기간은 유효하나 명단에 없는 참여자가 있습니다: <b>{undertaking.missingMembers.join(', ')}</b><br />
                      아래 발급으로 이 참여자들을 명단에 추가해 재발급합니다(현장 재서명).
                    </div>
                  )}
                  {undertaking?.status === 'MISSING' && (
                    <p className="text-xs text-amber-700">유효한 이행각서가 없습니다. 작성해 주세요.</p>
                  )}
                  <div>
                    <label className="label">관리감독자명</label>
                    <input className="input-base" value={uManager} onChange={(e) => setUManager(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">관리감독자 연락처 (선택)</label>
                    <input type="tel" inputMode="numeric" className="input-base" value={uPhone} onChange={(e) => setUPhone(formatPhone(e.target.value))} placeholder="01012345678" />
                  </div>
                  <div>
                    <label className="label">작업구역 (선택)</label>
                    <input className="input-base" value={uArea} onChange={(e) => setUArea(e.target.value)} placeholder="예: 울산공장 구내 작업" />
                  </div>
                  <p className="text-xs text-slate-500">※ 명단 = 이번 작업 참여자 {participants.length}명(+기존 명단 누적). 대표/현장소장 인은 현장.</p>
                  <div>
                    <label className="label">이행각서 내용 (아래로 스크롤하여 확인)</label>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 max-h-48 overflow-y-auto text-xs leading-relaxed text-slate-700">
                      <p className="mb-2">{UNDERTAKING_INTRO}</p>
                      <ol className="list-decimal pl-4 space-y-1">
                        {UNDERTAKING_CLAUSES.map((c, ci) => <li key={ci}>{c}</li>)}
                      </ol>
                    </div>
                    <label className="mt-2 flex items-start gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={uConfirm}
                        onChange={(e) => setUConfirm(e.target.checked)}
                      />
                      <span>위 이행각서 내용을 모두 확인하였으며 이에 동의합니다. (대표/현장소장 인은 현장 날인)</span>
                    </label>
                  </div>
                  <button type="button" onClick={issueUndertaking} disabled={uBusy || !uConfirm} className="btn-primary">
                    {uBusy ? '발급 중...' : '확인 완료 · 이행각서 발급 (6개월)'}
                  </button>
                </>
              )}
            </div>
          </section>

          {/* 교육결과서 안내 */}
          <section className="space-y-2">
            <h2 className="text-sm font-bold text-slate-700">③ 교육훈련결과서</h2>
            <div className="card text-xs text-slate-500">
              기존 안전교육 수료 기록으로 자동 출력됩니다(별도 작성 없음).
            </div>
          </section>

          {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

          <div className="flex gap-2">
            <button type="button" onClick={() => router.push('/work-permit/participants')} className="btn-secondary">이전</button>
            <button
              type="button"
              onClick={() => router.push('/work-permit/confirm')}
              disabled={!allValid}
              className="btn-primary"
            >
              다음
            </button>
          </div>
          {!allValid && !loading && (
            <p className="text-xs text-center text-slate-400">필수서류(개인서약 전원 + 업체 이행각서)가 모두 유효해야 다음으로 진행됩니다.</p>
          )}
        </>
      )}
    </main>
  );
}
