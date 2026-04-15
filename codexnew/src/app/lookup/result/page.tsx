'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface LookupData {
  status: 'NONE' | 'VALID' | 'EXPIRED';
  completionNumber?: string;
  completedAt?: string;
  validUntil?: string;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function daysUntil(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function LookupResultPage() {
  const router = useRouter();
  const [data, setData] = useState<LookupData | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('existingCompletion');
    if (!raw) {
      router.replace('/lookup');
      return;
    }
    setData(JSON.parse(raw));
  }, [router]);

  if (!data) return null;

  if (data.status === 'NONE') {
    return (
      <main className="space-y-5 py-6 text-center">
        <div className="text-5xl">🔍</div>
        <h1 className="text-xl font-bold text-slate-800">수료 이력이 없습니다</h1>
        <p className="text-sm text-slate-500">
          교육을 이수하지 않으셨거나 정보가 일치하지 않습니다.
        </p>
        <button className="btn-primary" onClick={() => router.push('/consent')}>
          교육 시작하기
        </button>
        <button className="btn-secondary" onClick={() => router.push('/lookup')}>
          다시 조회
        </button>
      </main>
    );
  }

  if (data.status === 'VALID') {
    const remain = daysUntil(data.validUntil!);
    return (
      <main className="space-y-5 py-6">
        <header className="text-center">
          <div className="text-5xl">✅</div>
          <h1 className="mt-2 text-2xl font-bold text-brand">유효한 수료 이력</h1>
          <p className="mt-1 text-sm text-slate-500">추가 교육이 필요하지 않습니다.</p>
        </header>

        <div className="card space-y-3">
          <Row label="수료번호" value={data.completionNumber!} mono />
          <Row label="수료일" value={formatDate(data.completedAt!)} />
          <Row label="유효기간" value={`~ ${formatDate(data.validUntil!)}`} highlight />
          <Row label="남은 일수" value={`${remain}일`} />
        </div>

        {remain <= 30 && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
            ⚠️ 유효기간 만료가 {remain}일 남았습니다. 만료 후 재교육이 필요합니다.
          </div>
        )}

        <button className="btn-primary" onClick={() => router.push('/')}>
          홈으로
        </button>
      </main>
    );
  }

  // EXPIRED
  return (
    <main className="space-y-5 py-6 text-center">
      <div className="text-5xl">⏰</div>
      <h1 className="text-2xl font-bold text-red-600">수료 유효기간 만료</h1>
      <p className="text-sm text-slate-500">
        이전 수료일: {formatDate(data.completedAt!)}
        <br />
        만료일: {formatDate(data.validUntil!)}
      </p>
      <div className="card space-y-2 text-left">
        <p className="font-bold text-slate-800">📘 재교육 안내</p>
        <p className="text-sm text-slate-600">
          최신 교육 과정과 시험으로 다시 이수해 주세요.
        </p>
      </div>
      <button className="btn-primary" onClick={() => router.push('/consent')}>
        재교육 시작
      </button>
    </main>
  );
}

function Row({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-500 text-sm">{label}</span>
      <span
        className={`font-bold ${mono ? 'font-mono' : ''} ${
          highlight ? 'text-brand' : 'text-slate-800'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
