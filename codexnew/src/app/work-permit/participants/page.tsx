'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { readDraft, writeDraft, type WpParticipant } from '@/lib/work-permit-draft';
import { maskPhone } from '@/lib/format';

interface RosterItem {
  name: string;
  birthYear: string;
  phoneLast4: string;
  targetLabel: string | null;
  expiresAt: string;
  ref: string;
  personId: string;
}

export default function WorkPermitParticipants() {
  const router = useRouter();
  const [workEnd, setWorkEnd] = useState('');
  const [list, setList] = useState<WpParticipant[]>([]);

  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [candidate, setCandidate] = useState<any | null>(null);

  // 우리 업체 수료자 불러오기
  const [applicantPhone, setApplicantPhone] = useState('');
  const [rosterStage, setRosterStage] = useState<'idle' | 'working' | 'otp' | 'list'>('idle');
  const [rosterError, setRosterError] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [addFailures, setAddFailures] = useState<string[]>([]);

  useEffect(() => {
    const d = readDraft();
    if (!d.company || !d.applicant || !d.info) {
      router.replace('/work-permit');
      return;
    }
    setWorkEnd(d.info.workEnd);
    setList(d.participants ?? []);
    setApplicantPhone(d.applicant.phone);
  }, [router]);

  const formatPhone = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 11);

  const onCheck = async () => {
    setError('');
    setCandidate(null);
    if (!name.trim() || !birthDate || phone.length < 10) {
      setError('이름·생년월일·연락처를 입력해 주세요.');
      return;
    }
    // 중복 방지
    const dup = list.some(
      (p) => p.name === name.trim() && p.birthDate === birthDate && p.phone === phone
    );
    if (dup) {
      setError('이미 추가된 참여자입니다.');
      return;
    }
    setChecking(true);
    try {
      const res = await fetch('/api/work-permits/verify-participant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, birthDate, phone, workEnd }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message || '확인에 실패했습니다.');
        return;
      }
      if (json.data.personId && list.some((p) => p.personId === json.data.personId)) {
        setError('이미 추가된 참여자입니다.');
        return;
      }
      setCandidate(json.data);
    } catch (e) {
      console.error(e);
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setChecking(false);
    }
  };

  const addCandidate = () => {
    if (!candidate || candidate.status !== 'VALID') return;
    const p: WpParticipant = {
      name: name.trim(),
      birthDate,
      phone,
      personId: candidate.personId ?? null,
      companyName: candidate.companyName,
      target: candidate.targetCode ?? null,
      targetLabel: candidate.targetLabel,
      vehicleNumber: candidate.vehicleNumber,
      equipmentType: candidate.equipmentType ?? null,
      spec: candidate.spec,
      completedAt: candidate.completedAt,
      expiresAt: candidate.expiresAt,
      marginDays: candidate.marginDays,
    };
    const next = [...list, p];
    setList(next);
    writeDraft({ participants: next });
    // reset input
    setName(''); setBirthDate(''); setPhone(''); setCandidate(null); setError('');
  };

  const postJson = async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  /** 목록 조회. 인증이 필요하면 false 를 돌려 문자 단계로 넘긴다. */
  const fetchRoster = async (): Promise<boolean> => {
    const d = readDraft();
    const json = await postJson('/api/work-permits/company-roster', { applicant: d.applicant, workEnd });
    if (!json.success) {
      if (json.code === 'PHONE_NOT_VERIFIED') return false;
      setRosterError(json.message || '불러오지 못했습니다. 아래에서 직접 입력해 주세요.');
      setRosterStage('idle');
      return true;
    }
    const items: RosterItem[] = json.data.items;
    setRoster(items);
    setSelected(new Set());
    setAddFailures([]);
    setRosterStage('list');
    // 이미 추가한 사람의 ref 를 새 값으로 바꾼다(만료 후 다시 불러온 경우).
    const fresh = new Map(items.map((it) => [it.personId, it.ref]));
    const next = (d.participants ?? []).map((p) =>
      p.ref && p.personId && fresh.has(p.personId) ? { ...p, ref: fresh.get(p.personId) } : p
    );
    setList(next);
    writeDraft({ participants: next });
    return true;
  };

  const sendCode = async () => {
    setRosterError('');
    const json = await postJson('/api/verify-phone/send', { phone: applicantPhone });
    if (!json.success) {
      setRosterError(json.message || '문자를 보내지 못했습니다. 아래에서 직접 입력해 주세요.');
      setRosterStage((s) => (s === 'otp' ? 'otp' : 'idle'));
      return;
    }
    setOtpCode('');
    setRosterStage('otp');
  };

  const startRoster = async () => {
    setRosterError('');
    setRosterStage('working');
    try {
      const done = await fetchRoster();
      if (!done) await sendCode();
    } catch (e) {
      console.error(e);
      setRosterError('네트워크 오류입니다. 아래에서 직접 입력해 주세요.');
      setRosterStage('idle');
    }
  };

  const confirmCode = async () => {
    setRosterError('');
    if (otpCode.length !== 6) {
      setRosterError('인증번호 6자리를 입력해 주세요.');
      return;
    }
    setRosterStage('working');
    try {
      const json = await postJson('/api/verify-phone/confirm', { phone: applicantPhone, code: otpCode });
      if (!json.success) {
        setRosterError(json.message || '인증에 실패했습니다.');
        setRosterStage('otp');
        return;
      }
      const done = await fetchRoster();
      if (!done) {
        setRosterError('인증을 확인하지 못했습니다. 다시 시도해 주세요.');
        setRosterStage('otp');
      }
    } catch (e) {
      console.error(e);
      setRosterError('네트워크 오류입니다. 다시 시도해 주세요.');
      setRosterStage('otp');
    }
  };

  const isAdded = (personId: string) => list.some((p) => p.personId === personId);

  const toggleSelected = (personId: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(personId)) n.delete(personId);
      else n.add(personId);
      return n;
    });
  };

  const addSelected = async () => {
    setAdding(true);
    setAddFailures([]);
    const next = [...list];
    const failures: string[] = [];
    for (const it of roster.filter((r) => selected.has(r.personId))) {
      if (next.some((p) => p.personId === it.personId)) continue;
      try {
        const json = await postJson('/api/work-permits/verify-participant', { ref: it.ref, workEnd });
        if (!json.success) {
          failures.push(`${it.name}: ${json.message || '확인에 실패했습니다.'}`);
          continue;
        }
        const c = json.data;
        if (c.status !== 'VALID') {
          failures.push(
            `${it.name}: ${c.status === 'EXPIRED' ? '작업 종료일 기준 교육이 만료되어 추가할 수 없습니다.' : '안전교육 수료 내역이 없어 추가할 수 없습니다.'}`
          );
          continue;
        }
        next.push({
          name: it.name,
          birthDate: '',
          phone: '',
          ref: it.ref,
          personId: c.personId ?? it.personId,
          birthYear: it.birthYear,
          phoneLast4: it.phoneLast4,
          companyName: c.companyName,
          target: c.targetCode ?? null,
          targetLabel: c.targetLabel,
          vehicleNumber: c.vehicleNumber,
          equipmentType: c.equipmentType ?? null,
          spec: c.spec,
          completedAt: c.completedAt,
          expiresAt: c.expiresAt,
          marginDays: c.marginDays,
        });
      } catch (e) {
        console.error(e);
        failures.push(`${it.name}: 네트워크 오류가 발생했습니다.`);
      }
    }
    setList(next);
    writeDraft({ participants: next });
    setSelected(new Set());
    setAddFailures(failures);
    setAdding(false);
  };

  const remove = (i: number) => {
    const next = list.filter((_, idx) => idx !== i);
    setList(next);
    writeDraft({ participants: next });
  };

  const goNext = () => {
    if (list.length === 0) {
      setError('참여자를 최소 1명 추가해 주세요.');
      return;
    }
    writeDraft({ participants: list });
    // 중장비·굴착 체크 시 장비 정보 확인 단계로, 아니면 필수서류로.
    const supp = readDraft().supplemental ?? {};
    const needEquip = supp.heavy === 'Y' || supp.excavation === 'Y';
    router.push(needEquip ? '/work-permit/equipment' : '/work-permit/docs');
  };

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-brand">STEP 3 / 5</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">참여자 확인</h1>
        <p className="mt-1 text-sm text-slate-500">
          참여자별 본인확인 후 추가합니다. 교육 유효성은 <b>작업 종료일</b> 기준입니다.
        </p>
      </header>

      <div className="card space-y-3">
        <p className="text-sm font-bold text-slate-700">우리 업체 수료자</p>
        {(rosterStage === 'idle' || rosterStage === 'working') && (
          <button type="button" onClick={startRoster} disabled={rosterStage === 'working'} className="btn-secondary">
            {rosterStage === 'working' ? '확인 중...' : '우리 업체 수료자 불러오기'}
          </button>
        )}
        {rosterStage === 'otp' && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              신청인 번호 {maskPhone(applicantPhone)} 로 보낸 인증번호를 입력해 주세요.
            </p>
            <input
              type="tel"
              inputMode="numeric"
              className="input-base"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="인증번호 6자리"
            />
            <div className="flex gap-2">
              <button type="button" onClick={confirmCode} className="btn-primary">확인</button>
              <button type="button" onClick={sendCode} className="btn-secondary">재전송</button>
            </div>
          </div>
        )}
        {rosterError && <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{rosterError}</div>}
        {rosterStage === 'list' && (
          <div className="space-y-2">
            {roster.length === 0 && <p className="text-sm text-slate-500">불러올 수 있는 수료자가 없습니다.</p>}
            {roster.map((it) => {
              const added = isAdded(it.personId);
              return (
                <label key={it.personId} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={added || selected.has(it.personId)}
                    disabled={added}
                    onChange={() => toggleSelected(it.personId)}
                  />
                  <span className="min-w-0">
                    <span className="font-bold text-slate-800">{it.name}</span>{' '}
                    <span className="text-xs text-slate-500">{it.birthYear}년생 · ****-{it.phoneLast4}</span>
                    <span className="block text-xs text-slate-500">
                      {it.targetLabel ?? ''} · 교육 유효 ~{it.expiresAt.substring(0, 10)}
                      {added && <b className="text-emerald-700"> · 추가됨</b>}
                    </span>
                  </span>
                </label>
              );
            })}
            {addFailures.map((f) => (
              <p key={f} className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{f}</p>
            ))}
            {roster.length > 0 && (
              <button type="button" onClick={addSelected} disabled={adding || selected.size === 0} className="btn-primary">
                {adding ? '추가 중...' : `선택한 ${selected.size}명 추가`}
              </button>
            )}
            <p className="text-xs text-slate-500">업체 소속이 다르거나 교육 이력이 없는 분은 아래에서 직접 입력하세요.</p>
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <div>
          <label className="label">성명</label>
          <input className="input-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
        </div>
        <div>
          <label className="label">생년월일</label>
          <input type="date" max="9999-12-31" className="input-base" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </div>
        <div>
          <label className="label">연락처 (숫자만)</label>
          <input type="tel" inputMode="numeric" className="input-base" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="01012345678" />
        </div>
        {error && <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <button type="button" onClick={onCheck} disabled={checking} className="btn-secondary">
          {checking ? '확인 중...' : '본인확인'}
        </button>

        {candidate && (
          <div
            className={`rounded-xl border-2 p-3 ${
              candidate.status === 'VALID'
                ? 'border-emerald-300 bg-emerald-50'
                : 'border-red-300 bg-red-50'
            }`}
          >
            <p className="font-bold text-slate-800">
              {candidate.name}{' '}
              <span className="text-xs font-normal text-slate-500">{candidate.targetLabel ?? ''}</span>
            </p>
            <p className="text-xs text-slate-600 mt-0.5">{candidate.companyName ?? '업체 미연결'} · {candidate.phoneMasked}</p>
            {candidate.status === 'VALID' && (
              <>
                <p className="text-xs text-emerald-700 mt-1">
                  ✅ 교육 유효 (만료 {candidate.expiresAt?.substring(0, 10)})
                  {typeof candidate.marginDays === 'number' && candidate.marginDays < 7 && (
                    <span className="text-amber-700"> · 재교육 임박(작업종료일까지 {candidate.marginDays}일)</span>
                  )}
                </p>
                <button type="button" onClick={addCandidate} className="btn-primary mt-2">참여자 추가</button>
              </>
            )}
            {candidate.status === 'EXPIRED' && (
              <p className="text-xs text-red-700 mt-1">⛔ 작업 종료일 기준 교육이 만료되어 추가할 수 없습니다 (만료 {candidate.expiresAt?.substring(0, 10)}). 재교육 후 신청해 주세요.</p>
            )}
            {candidate.status === 'NONE' && (
              <p className="text-xs text-red-700 mt-1">⛔ 안전교육 수료 내역이 없어 추가할 수 없습니다.</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs text-slate-500">추가된 참여자 {list.length}명</p>
        {list.map((p, i) => (
          <div key={i} className="card flex items-start justify-between">
            <div>
              <p className="font-bold text-slate-800">{p.name} <span className="text-xs font-normal text-slate-500">{p.targetLabel ?? ''}</span></p>
              <p className="text-xs text-slate-600 mt-0.5">{p.companyName ?? ''}{p.vehicleNumber ? ` · 🚗 ${p.vehicleNumber}` : ''}</p>
              {p.ref && <p className="text-xs text-slate-500 mt-0.5">{p.birthYear}년생 · ****-{p.phoneLast4}</p>}
              <p className="text-xs text-slate-500 mt-0.5">교육 유효 ~{p.expiresAt?.substring(0, 10)}</p>
            </div>
            <button type="button" onClick={() => remove(i)} className="text-sm text-red-600 hover:underline">삭제</button>
          </div>
        ))}
        {list.length === 0 && <div className="card text-center text-slate-500 py-6">아직 추가된 참여자가 없습니다.</div>}
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => router.push('/work-permit/info')} className="btn-secondary">이전</button>
        <button type="button" onClick={goNext} disabled={list.length === 0} className="btn-primary">다음</button>
      </div>
    </main>
  );
}
