'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import SignaturePad from '@/components/SignaturePad';

/**
 * 참여자 본인 확인 — 해당 작업허가서에 [확인] + 서명.
 * 확인 시각·서명이 tbm.confirmations 에 기록되어 TBM 참석자 서명으로 자동 인쇄된다.
 */
export default function ParticipantConfirm() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const permitId = params?.id;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [sig, setSig] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const formatPhone = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 11);

  const submit = async () => {
    setError('');
    if (!name.trim() || phone.length < 10) {
      setError('이름·연락처를 정확히 입력해 주세요.');
      return;
    }
    if (!sig) {
      setError('서명을 입력해 주세요.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/work-permits/${permitId}/confirm-participant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, signature: sig }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message || '확인 저장에 실패했습니다.');
        return;
      }
      setDone(true);
    } catch (e) {
      console.error(e);
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <main className="space-y-6">
        <div className="card text-center py-8">
          <p className="text-emerald-700 font-bold text-lg">✅ 확인이 저장되었습니다.</p>
          <p className="mt-1 text-sm text-slate-500">서명이 TBM 참석자란에 자동 인쇄됩니다.</p>
        </div>
        <button onClick={() => router.push('/')} className="btn-secondary">홈으로</button>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-800">✍️ 작업 참여 확인</h1>
        <p className="mt-1 text-sm text-slate-500">
          해당 작업허가서의 <b>참여자 본인</b>이 직접 확인·서명합니다. 서명은 TBM 참석자란에 자동 인쇄됩니다.
        </p>
      </header>

      <div className="card space-y-3">
        <div>
          <label className="label">성명</label>
          <input className="input-base" value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
        </div>
        <div>
          <label className="label">연락처 (숫자만)</label>
          <input type="tel" inputMode="numeric" className="input-base" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="01012345678" />
        </div>
        <div>
          <label className="label">서명 (마우스 또는 손가락)</label>
          <SignaturePad onChange={setSig} />
        </div>
        {error && <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <button onClick={submit} disabled={submitting || !sig} className="btn-primary">
          {submitting ? '저장 중...' : '확인 · 서명 저장'}
        </button>
      </div>

      <button onClick={() => router.push('/')} className="btn-secondary">홈으로</button>
    </main>
  );
}
