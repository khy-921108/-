'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function ConsentPage() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);

  const handleNext = () => {
    if (!agreed) return;
    sessionStorage.setItem('consent', 'Y');
    router.push('/register');
  };

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-brand">STEP 1 / 5</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">
          개인정보 수집 및 이용 동의
        </h1>
      </header>

      <section className="card text-sm leading-relaxed text-slate-700 space-y-3">
        <h2 className="font-bold text-slate-800">수집 항목</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>소속(업체명)</li>
          <li>성명</li>
          <li>생년월일</li>
          <li>연락처</li>
          <li>대상 구분 (화물차/작업자/중장비)</li>
        </ul>

        <h2 className="mt-4 font-bold text-slate-800">수집 목적</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>안전보건교육 이수 및 수료 이력 관리</li>
          <li>6개월 유효기간 관리 및 재교육 안내</li>
          <li>법정 의무교육 증빙</li>
        </ul>

        <h2 className="mt-4 font-bold text-slate-800">보유 및 이용 기간</h2>
        <p>수료일로부터 3년 보관 후 파기 (산업안전보건법 기준)</p>

        <p className="mt-4 text-xs text-slate-500">
          ※ 위 개인정보 수집에 동의하지 않으시면 교육 이수가 불가능합니다.
        </p>
      </section>

      <label className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200 cursor-pointer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="h-5 w-5 accent-brand"
        />
        <span className="font-semibold text-slate-700">
          개인정보 수집 및 이용에 동의합니다.
        </span>
      </label>

      <button
        type="button"
        onClick={handleNext}
        disabled={!agreed}
        className="btn-primary"
      >
        다음
      </button>
    </main>
  );
}
