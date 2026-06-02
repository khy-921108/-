'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SignaturePad from '@/components/SignaturePad';

interface UnsignedItem {
  pledgeId: string;
  companyName: string | null;
  issuedAt: string;
  expiresAt: string;
}

export default function SelfSignPledge() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [items, setItems] = useState<UnsignedItem[] | null>(null);
  const [sig, setSig] = useState('');
  const [loading, setLoading] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const formatPhone = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 11);

  const lookup = async () => {
    setError('');
    setDone(false);
    if (!name.trim() || !birthDate || phone.length < 10) {
      setError('이름·생년월일·연락처를 정확히 입력해 주세요.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/safety-pledges/my-unsigned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, birthDate, phone }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message || '조회에 실패했습니다.');
        setItems(null);
        return;
      }
      setItems(json.data.items);
    } catch (e) {
      console.error(e);
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const submitSign = async () => {
    setError('');
    if (!sig) {
      setError('서명을 입력해 주세요.');
      return;
    }
    setSigning(true);
    try {
      const res = await fetch('/api/safety-pledges/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, birthDate, phone, signature: sig }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message || '서명 저장 실패');
        return;
      }
      setDone(true);
      setItems([]);
    } catch (e) {
      console.error(e);
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setSigning(false);
    }
  };

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">✍️ 내 서약 서명</h1>
        <p className="mt-1 text-sm text-slate-500">
          발급된 <b>안전준수 서약</b>에 본인이 직접 서명합니다. 한 번 서명하면 6개월간 모든 작업에 적용됩니다.
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
        <button onClick={lookup} disabled={loading} className="btn-primary">
          {loading ? '조회 중...' : '본인확인'}
        </button>
      </div>

      {done && (
        <div className="card text-center text-emerald-700 font-bold py-6">✅ 서명이 저장되었습니다. 감사합니다.</div>
      )}

      {items !== null && !done && (
        items.length === 0 ? (
          <div className="card text-center text-slate-500 py-8">
            서명할 미서명 서약이 없습니다.<br />
            <span className="text-xs">이미 서명을 완료했거나, 발급된 서약이 없습니다.</span>
          </div>
        ) : (
          <div className="card space-y-3">
            <p className="text-sm text-slate-700">
              미서명 서약 <b>{items.length}건</b>이 있습니다. 아래에 서명하면 모두 적용됩니다.
            </p>
            <ul className="text-xs text-slate-500 space-y-1">
              {items.map((it) => (
                <li key={it.pledgeId}>· {it.companyName ?? '업체 미상'} — 유효 ~{it.expiresAt?.substring(0, 10)}</li>
              ))}
            </ul>
            <div>
              <label className="label">서명 (마우스 또는 손가락)</label>
              <SignaturePad onChange={setSig} />
            </div>
            <button onClick={submitSign} disabled={signing || !sig} className="btn-primary">
              {signing ? '저장 중...' : '서명 저장'}
            </button>
          </div>
        )
      )}

      <button onClick={() => router.push('/')} className="btn-secondary">홈으로</button>
    </main>
  );
}
