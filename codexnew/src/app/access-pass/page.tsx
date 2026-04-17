'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function AccessPassPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = name.trim() && birthDate && phone.length >= 10 && !loading;
  const formatPhone = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 11);

  const submit = async () => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, birthDate, phone }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message || '조회 실패');
        setLoading(false);
        return;
      }
      sessionStorage.setItem('accessPassData', JSON.stringify(json.data));
      router.push('/access-pass/result');
    } catch (e) {
      console.error(e);
      setError('네트워크 오류');
      setLoading(false);
    }
  };

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

      <div className="space-y-4">
        <div>
          <label className="label">성명</label>
          <input
            className="input-base"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
          />
        </div>
        <div>
          <label className="label">생년월일</label>
          <input
            type="date"
            className="input-base"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label">연락처</label>
          <input
            type="tel"
            inputMode="numeric"
            className="input-base"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            placeholder="01012345678"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary">
        {loading ? '조회 중...' : '출입증 보기'}
      </button>

      <button
        type="button"
        onClick={() => router.push('/')}
        className="btn-secondary"
      >
        홈으로
      </button>
    </main>
  );
}
