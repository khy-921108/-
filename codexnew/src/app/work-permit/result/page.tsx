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
  const [sig, setSig] = useState<{ total: number; signed: number; unsigned: string[] } | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('wpResult');
    if (!raw) {
      router.replace('/work-permit');
      return;
    }
    let parsed: WpResult;
    try {
      parsed = JSON.parse(raw);
      setResult(parsed);
    } catch {
      router.replace('/work-permit');
      return;
    }
    // 서명 완료/미완료 집계 (개인서약 기준)
    (async () => {
      try {
        const res = await fetch(`/api/work-permits/${parsed.permitId}`);
        const json = await res.json();
        const pledges = json?.data?.docs?.pledges ?? [];
        if (Array.isArray(pledges) && pledges.length > 0) {
          const unsigned = pledges.filter((p: any) => !p.signature).map((p: any) => p.name);
          setSig({ total: pledges.length, signed: pledges.length - unsigned.length, unsigned });
        }
      } catch { /* 무시 */ }
    })();
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

      {sig && (
        sig.unsigned.length === 0 ? (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
            ✅ 참여자 개인서약 서명 완료 ({sig.signed}/{sig.total}명)
          </div>
        ) : (
          <div className="rounded-xl bg-amber-50 border border-amber-300 p-3 text-sm text-amber-800 space-y-2">
            <p>⚠️ 개인서약 <b>서명 미완료 {sig.unsigned.length}명</b> ({sig.signed}/{sig.total} 완료)</p>
            <p className="text-xs">미서명: {sig.unsigned.join(', ')}</p>
            <p className="text-xs">※ 예전에 서명 없이 발급된 서약입니다. 다음 신청 때 해당 참여자가 <b>직접 서명하면 재발급</b>되어 해결됩니다.</p>
          </div>
        )
      )}

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
