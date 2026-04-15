'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type TargetCode = 'TRUCK' | 'WORKER' | 'HEAVY';

const TARGETS: { code: TargetCode; label: string; emoji: string }[] = [
  { code: 'TRUCK', label: '화물차 기사', emoji: '🚚' },
  { code: 'WORKER', label: '일반 작업자', emoji: '👷' },
  { code: 'HEAVY', label: '중장비 기사', emoji: '🏗️' },
];

export default function RegisterPage() {
  const router = useRouter();
  const [affiliation, setAffiliation] = useState('');
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [targetTypeCode, setTargetTypeCode] = useState<TargetCode | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // 동의를 먼저 하도록 강제
    if (sessionStorage.getItem('consent') !== 'Y') {
      router.replace('/consent');
    }
  }, [router]);

  const formatPhone = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 11);

  const canSubmit =
    affiliation.trim() &&
    name.trim() &&
    birthDate &&
    phone.length >= 10 &&
    targetTypeCode &&
    !loading;

  const onSubmit = async () => {
    setError('');
    setLoading(true);

    try {
      // 1. 기존 수료 조회
      const lookupRes = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, birthDate, name }),
      });
      const lookup = await lookupRes.json();

      if (lookup.success && lookup.data.status === 'VALID') {
        // 이미 유효한 수료 있음 → 상태 화면으로
        sessionStorage.setItem('existingCompletion', JSON.stringify(lookup.data));
        router.push('/lookup/result');
        return;
      }

      // 2. 세션 생성
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          affiliation,
          name,
          birthDate,
          phone,
          targetTypeCode,
          consentYn: true,
        }),
      });
      const json = await res.json();

      if (!json.success) {
        setError(json.message || '세션 생성에 실패했습니다.');
        setLoading(false);
        return;
      }

      sessionStorage.setItem('sessionId', json.data.sessionId);
      router.push('/video');
    } catch (e) {
      console.error(e);
      setError('네트워크 오류가 발생했습니다.');
      setLoading(false);
    }
  };

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-brand">STEP 2 / 5</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">기본정보 입력</h1>
        <p className="mt-1 text-sm text-slate-500">
          수료증 발급에 필요한 정보입니다.
        </p>
      </header>

      <div className="space-y-4">
        <div>
          <label className="label">소속 (업체명)</label>
          <input
            className="input-base"
            value={affiliation}
            onChange={(e) => setAffiliation(e.target.value)}
            placeholder="예: A물류"
          />
        </div>
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
        <div>
          <label className="label">대상 구분</label>
          <div className="grid grid-cols-3 gap-2">
            {TARGETS.map((t) => (
              <button
                key={t.code}
                type="button"
                onClick={() => setTargetTypeCode(t.code)}
                className={`rounded-xl border-2 py-4 font-bold transition ${
                  targetTypeCode === t.code
                    ? 'border-brand bg-brand/5 text-brand'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <div className="text-2xl">{t.emoji}</div>
                <div className="mt-1 text-xs">{t.label}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="btn-primary"
      >
        {loading ? '확인 중...' : '교육 시작'}
      </button>
    </main>
  );
}
