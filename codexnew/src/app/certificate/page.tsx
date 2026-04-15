'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface CompletionData {
  completionId: string;
  completionNumber: string;
  completedAt: string;
  validUntil: string;
  score?: number;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function CertificatePage() {
  const router = useRouter();
  const [data, setData] = useState<CompletionData | null>(null);
  const [trainee, setTrainee] = useState<{ name: string; affiliation: string } | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('completion');
    if (!raw) {
      router.replace('/');
      return;
    }
    setData(JSON.parse(raw));

    // 세션 정보에서 이름/소속 로드
    const sid = sessionStorage.getItem('sessionId');
    if (sid) {
      fetch(`/api/sessions/${sid}/status`)
        .then((r) => r.json())
        .then((json) => {
          if (json.success && json.data.trainee) {
            setTrainee(json.data.trainee);
          }
        });
    }
  }, [router]);

  const finish = () => {
    // 세션 스토리지 정리 후 홈으로
    sessionStorage.clear();
    router.push('/');
  };

  if (!data) return null;

  return (
    <main className="space-y-5 py-4">
      <header className="text-center">
        <p className="text-sm font-semibold text-brand">STEP 5 / 5</p>
        <h1 className="mt-1 text-2xl font-extrabold text-slate-800">수료증 발급 완료</h1>
      </header>

      <div className="card border-2 border-brand/30 space-y-4">
        <div className="text-center">
          <p className="text-xs font-bold text-brand tracking-widest">CERTIFICATE</p>
          <p className="mt-1 text-lg font-extrabold text-slate-800">안전보건교육 수료증</p>
        </div>

        <div className="border-t border-dashed border-slate-200 pt-4 space-y-2 text-sm">
          {trainee && (
            <>
              <Row label="소속" value={trainee.affiliation} />
              <Row label="성명" value={trainee.name} />
            </>
          )}
          <Row label="수료번호" value={data.completionNumber} mono />
          <Row label="수료일" value={formatDate(data.completedAt)} />
          <Row
            label="유효기간"
            value={`~ ${formatDate(data.validUntil)}`}
            highlight
          />
          {typeof data.score === 'number' && (
            <Row label="시험 점수" value={`${data.score} / 10`} />
          )}
        </div>

        <div className="flex justify-center pt-2">
          <div className="rounded-lg bg-white p-3 border border-slate-200">
            <QRCodeSVG value={`COMPLETE-${data.completionId}`} size={128} />
          </div>
        </div>
        <p className="text-center text-xs text-slate-400">
          본 QR은 관리자 확인용 수료 식별자입니다.
        </p>
      </div>

      <div className="rounded-xl bg-brand/5 p-4 text-sm text-slate-700">
        <p className="font-bold text-brand mb-1">안내</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>수료번호는 공장 출입 시 제시할 수 있습니다.</li>
          <li>유효기간 만료 후 재이수가 필요합니다.</li>
          <li>재접속 시 "기존 수료 이력 조회"로 확인 가능합니다.</li>
        </ul>
      </div>

      <button type="button" onClick={finish} className="btn-primary">
        완료
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
      <span className="text-slate-500">{label}</span>
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
