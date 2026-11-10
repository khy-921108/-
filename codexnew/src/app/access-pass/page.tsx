'use client';

import { normalizeKrPhone } from '@/lib/phone';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useDevice } from '@/lib/use-device';
import { useRememberDevice } from '@/components/RememberDevice';

type Identity = { name: string; birthDate: string; phone: string };

export default function AccessPassPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 기억된 휴대폰이면 바로 조회(주소에 ?manual=1 이면 입력칸)
  const { me, loading: devLoading } = useDevice();
  const remember = useRememberDevice();
  const [manual, setManual] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const autoTried = useRef(false);

  const canSubmit = name.trim() && birthDate && phone.length >= 10 && !loading;
  const formatPhone = normalizeKrPhone;

  const lookup = async (who: Identity, auto: boolean) => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(who),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message || '조회 실패');
        setLoading(false);
        setAutoRunning(false);
        return;
      }
      if (!auto) await remember.run(who);
      sessionStorage.setItem('accessPassData', JSON.stringify(json.data));
      if (auto) {
        sessionStorage.setItem('accessPassFromDevice', 'Y');
        router.replace('/access-pass/result');
      } else {
        sessionStorage.removeItem('accessPassFromDevice');
        router.push('/access-pass/result');
      }
    } catch (e) {
      console.error(e);
      setError('네트워크 오류');
      setLoading(false);
      setAutoRunning(false);
    }
  };

  const submit = () => lookup({ name, birthDate, phone }, false);

  useEffect(() => {
    const isManual = new URLSearchParams(window.location.search).get('manual') === '1';
    setManual(isManual);
    if (devLoading || autoTried.current) return;
    autoTried.current = true;
    if (!me || isManual) return;
    setName(me.name);
    setBirthDate(me.birthDate);
    setPhone(me.phone);
    setAutoRunning(true);
    lookup(me, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devLoading, me]);

  const showOther = () => {
    setManual(true);
    setAutoRunning(false);
    setName('');
    setBirthDate('');
    setPhone('');
    setError('');
  };

  if (autoRunning) {
    return (
      <main className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-slate-800">출입증 조회</h1>
        </header>
        <div className="card py-6 text-center text-slate-500">기억된 휴대폰으로 출입증을 여는 중…</div>
        <button type="button" onClick={showOther} className="w-full text-center text-sm text-slate-500 underline">
          다른 사람 출입증 보기
        </button>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">출입증 조회</h1>
        <p className="mt-1 text-sm text-slate-500">
          교육 수료자의 모바일 출입증을 확인합니다.
          <br />
          경비실에 화면을 제시해 주세요.
        </p>
      </header>

      <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); if (canSubmit) submit(); }}>
      <div className="space-y-4">
        <div>
          <label className="label">성명</label>
          <input
            name="name"
            autoComplete="name"
            className="input-base"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
          />
        </div>
        <div>
          <label className="label">생년월일</label>
          <input
            type="date" max="9999-12-31"
            name="bday"
            autoComplete="bday"
            className="input-base"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label">연락처</label>
          <input
            type="tel"
            name="tel"
            autoComplete="tel"
            inputMode="numeric"
            className="input-base"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            placeholder="01012345678"
          />
        </div>
        {(!me || manual) && remember.checkbox}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <button type="submit" disabled={!canSubmit} className="btn-primary">
        {loading ? '조회 중...' : '출입증 보기'}
      </button>
      </form>

      <button
        type="button"
        onClick={() => router.push('/')}
        className="btn-secondary"
      >
        홈으로
      </button>
      {remember.dialog}
    </main>
  );
}
