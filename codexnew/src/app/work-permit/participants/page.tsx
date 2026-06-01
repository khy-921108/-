'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { readDraft, writeDraft, type WpParticipant } from '@/lib/work-permit-draft';

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

  useEffect(() => {
    const d = readDraft();
    if (!d.company || !d.applicant || !d.info) {
      router.replace('/work-permit');
      return;
    }
    setWorkEnd(d.info.workEnd);
    setList(d.participants ?? []);
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
      companyName: candidate.companyName,
      targetLabel: candidate.targetLabel,
      vehicleNumber: candidate.vehicleNumber,
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
    router.push('/work-permit/confirm');
  };

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-brand">STEP 3 / 4</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">참여자 확인</h1>
        <p className="mt-1 text-sm text-slate-500">
          참여자별 본인확인 후 추가합니다. 교육 유효성은 <b>작업 종료일</b> 기준입니다.
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
