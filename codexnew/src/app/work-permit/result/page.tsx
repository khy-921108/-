'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface WpResult {
  permitId: string;
  permitNumber: string;
  status: string;
  createdAt: string;
}

export default function WorkPermitResult() {
  const router = useRouter();
  const [result, setResult] = useState<WpResult | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('wpResult');
    if (!raw) {
      router.replace('/work-permit');
      return;
    }
    try {
      setResult(JSON.parse(raw));
    } catch {
      router.replace('/work-permit');
    }
  }, [router]);

  if (!result) return null;

  return (
    <main className="space-y-6">
      <div className="card text-center space-y-3">
        <div className="text-5xl">✅</div>
        <h1 className="text-2xl font-bold text-slate-800">작업허가 신청 완료</h1>
        <p className="text-sm text-slate-500">신청번호를 확인하고 허가서를 출력하세요.</p>
        <div className="rounded-xl bg-brand/5 border-2 border-brand py-4">
          <p className="text-xs text-slate-500">신청번호</p>
          <p className="text-2xl font-extrabold text-brand tracking-wider">{result.permitNumber}</p>
        </div>
      </div>

      <div className="space-y-3">
        <Link href={`/work-permit/print/${result.permitId}`} className="btn-primary block text-center">
          📄 허가서 인쇄 / 양식 다운로드
        </Link>
        <a href={`/api/work-permits/${result.permitId}/xlsx`} className="btn-secondary block text-center">
          📥 회사 양식 .xlsx 바로 다운로드
        </a>
        <Link href="/" className="block text-center text-sm text-slate-500 underline">홈으로</Link>
      </div>

      <p className="text-xs text-slate-400 text-center">
        ※ 안전조치·서명·TBM 세부 내용은 현장에서 직접 작성·서명합니다.
      </p>
    </main>
  );
}
