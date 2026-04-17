'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatDate, daysUntil } from '@/lib/format';

interface AccessPassData {
  status: 'NONE' | 'VALID' | 'EXPIRED';
  name?: string;
  affiliation?: string;
  vehicleNumber?: string | null;
  targetCode?: string | null;
  targetLabel?: string | null;
  birthYear?: string | null;
  phoneMasked?: string | null;
  score?: number | null;
  completionNumber?: string;
  completedAt?: string;
  validUntil?: string;
}

const TARGET_EMOJI: Record<string, string> = {
  TRUCK: '🚚',
  WORKER: '👷',
  HEAVY: '🏗️',
};

export default function AccessPassResultPage() {
  const router = useRouter();
  const [data, setData] = useState<AccessPassData | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('accessPassData');
    if (!raw) {
      router.replace('/access-pass');
      return;
    }
    setData(JSON.parse(raw));
  }, [router]);

  if (!data) return null;

  // ─── NONE: 수료 이력 없음 ───
  if (data.status === 'NONE') {
    return (
      <main className="space-y-4">
        <div className="rounded-2xl bg-red-600 text-white p-8 text-center shadow-lg">
          <div className="text-6xl">❌</div>
          <h1 className="mt-3 text-3xl font-black">출입 불가</h1>
          <p className="mt-2 text-base opacity-90">안전보건교육 미수료</p>
        </div>

        <div className="card space-y-3 text-center">
          <p className="text-slate-700">조회된 수료 이력이 없습니다.</p>
          <p className="text-sm text-slate-500">
            공장 출입 전 안전보건교육을
            <br />
            먼저 이수해 주세요.
          </p>
        </div>

        <button className="btn-primary" onClick={() => router.push('/consent')}>
          교육 시작하기
        </button>
        <button className="btn-secondary" onClick={() => router.push('/access-pass')}>
          다시 조회
        </button>
      </main>
    );
  }

  // ─── EXPIRED: 만료 ───
  if (data.status === 'EXPIRED') {
    return (
      <main className="space-y-4">
        <div className="rounded-2xl bg-red-600 text-white p-8 text-center shadow-lg">
          <div className="text-6xl">❌</div>
          <h1 className="mt-3 text-3xl font-black">수료 만료</h1>
          <p className="mt-2 text-base opacity-90">재교육이 필요합니다</p>
        </div>

        <div className="card space-y-3">
          <PassRow label="성 명" value={data.name ?? '-'} big />
          <PassRow label="소 속" value={data.affiliation ?? '-'} />
          <hr className="border-slate-200" />
          <PassRow label="이전 수료일" value={formatDate(data.completedAt)} />
          <PassRow
            label="만 료 일"
            value={`${formatDate(data.validUntil)} (만료됨)`}
            highlight="red"
          />
        </div>

        <button className="btn-primary" onClick={() => router.push('/consent')}>
          재교육 시작하기
        </button>
        <button className="btn-secondary" onClick={() => router.push('/')}>
          홈으로
        </button>
      </main>
    );
  }

  // ─── VALID: 유효 수료 (출입 가능) ───
  const dday = data.validUntil ? daysUntil(data.validUntil) : 0;
  const emoji = data.targetCode ? TARGET_EMOJI[data.targetCode] ?? '' : '';

  return (
    <main className="space-y-4">
      <div className="rounded-2xl bg-emerald-500 text-white p-8 text-center shadow-lg">
        <div className="text-6xl">✅</div>
        <h1 className="mt-3 text-3xl font-black tracking-wide">출 입 가 능</h1>
        <p className="mt-2 text-base opacity-90">안전보건교육 수료 확인</p>
      </div>

      <div className="card space-y-3">
        <PassRow label="성 명" value={data.name ?? '-'} big />
        <PassRow label="소 속" value={data.affiliation ?? '-'} />
        {data.birthYear && (
          <PassRow label="생년월일" value={`${data.birthYear}년생`} />
        )}
        {data.phoneMasked && (
          <PassRow label="연 락 처" value={data.phoneMasked} />
        )}
      </div>

      <div className="card space-y-3">
        <PassRow
          label="구 분"
          value={`${emoji} ${data.targetLabel ?? '-'}`}
        />
        {data.vehicleNumber && (
          <div className="flex justify-between items-center bg-slate-50 -mx-6 px-6 py-3 rounded-xl">
            <span className="text-slate-500 text-sm">차량번호</span>
            <span className="text-3xl font-black tracking-wider text-slate-800">
              {data.vehicleNumber}
            </span>
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <PassRow
          label="수료번호"
          value={data.completionNumber ?? '-'}
          mono
        />
        <PassRow label="수 료 일" value={formatDate(data.completedAt)} />
        <PassRow
          label="유효기간"
          value={`${formatDate(data.validUntil)} 까지`}
          highlight="emerald"
          big
        />
        <PassRow label="남은 일수" value={`D-${dday}`} />
        {data.score !== null && data.score !== undefined && (
          <PassRow label="시험점수" value={`${data.score} / 10`} />
        )}
      </div>

      {dday <= 30 && dday > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
          ⚠️ 유효기간 만료가 {dday}일 남았습니다. 만료 전 재교육을 준비해 주세요.
        </div>
      )}

      <div className="rounded-xl bg-slate-100 p-4 text-xs text-slate-600 text-center">
        ⚠️ 실제 출입은 경비실 및 담당자
        <br />
        안내에 따릅니다.
      </div>

      <button className="btn-secondary" onClick={() => router.push('/')}>
        홈으로
      </button>
    </main>
  );
}

function PassRow({
  label,
  value,
  mono,
  highlight,
  big,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: 'emerald' | 'red';
  big?: boolean;
}) {
  const colorClass =
    highlight === 'emerald'
      ? 'text-emerald-700'
      : highlight === 'red'
      ? 'text-red-600'
      : 'text-slate-800';
  const sizeClass = big ? 'text-xl' : 'text-base';
  return (
    <div className="flex justify-between items-center gap-3">
      <span className="text-slate-500 text-sm shrink-0">{label}</span>
      <span
        className={`font-bold ${mono ? 'font-mono text-xs' : sizeClass} ${colorClass} text-right break-all`}
      >
        {value}
      </span>
    </div>
  );
}
