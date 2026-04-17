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

      <section className="card text-sm leading-relaxed text-slate-700 space-y-4">
        <div>
          <h2 className="font-bold text-slate-800">1. 수집 항목</h2>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>소속(업체명)</li>
            <li>성명</li>
            <li>생년월일</li>
            <li>연락처</li>
            <li>대상 구분 (화물차/작업자/중장비)</li>
            <li>차량번호 (화물차·중장비 기사에 한함)</li>
          </ul>
        </div>

        <div>
          <h2 className="font-bold text-slate-800">2. 수집·이용 목적</h2>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>안전보건교육 이수 및 수료 이력 관리</li>
            <li>6개월 유효기간 관리 및 재교육 안내</li>
            <li>법정 의무교육 증빙</li>
            <li>출입 차량 식별 및 관리 (해당자에 한함)</li>
          </ul>
        </div>

        <div>
          <h2 className="font-bold text-slate-800">3. 수집 근거 (법적 근거)</h2>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>「산업안전보건법」 제29조 (근로자에 대한 안전보건교육)</li>
            <li>「개인정보 보호법」 제15조 (개인정보의 수집·이용)</li>
          </ul>
        </div>

        <div>
          <h2 className="font-bold text-slate-800">4. 제3자 제공</h2>
          <p className="mt-1">
            수집된 개인정보는 다음과 같이 제3자에게 제공될 수 있습니다.
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>제공받는 자: 원청사(동남알루미늄), 고용노동부 등 관계 기관</li>
            <li>제공 항목: 성명, 소속, 연락처, 수료 이력, 차량번호(해당자)</li>
            <li>제공 목적: 안전보건교육 이수 확인, 법정 점검 대응, 출입 차량 관리</li>
            <li>보유 기간: 수료일로부터 3년</li>
          </ul>
        </div>

        <div>
          <h2 className="font-bold text-slate-800">5. 보유 및 이용 기간</h2>
          <p className="mt-1">
            수료일로부터 <strong>3년 보관 후 지체 없이 파기</strong>합니다. (산업안전보건법 기준)
          </p>
        </div>

        <div>
          <h2 className="font-bold text-slate-800">6. 동의 거부권 안내</h2>
          <p className="mt-1">
            귀하는 개인정보 수집·이용에 대한 동의를 거부할 권리가 있습니다.
            다만, <strong>동의를 거부할 경우 안전보건교육 이수 및 공장 출입이 제한</strong>될 수 있음을 알려드립니다.
          </p>
        </div>
      </section>

      <label className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200 cursor-pointer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="h-5 w-5 accent-brand"
        />
        <span className="font-semibold text-slate-700">
          위 내용을 모두 확인하였으며, 개인정보 수집 및 이용에 동의합니다.
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
