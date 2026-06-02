import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-col items-center justify-center min-h-[80vh] text-center">
      <div className="mb-8">
        <div className="inline-block rounded-full bg-brand/10 px-4 py-2 text-sm font-bold text-brand">
          SAFETY EDUCATION
        </div>
        <h1 className="mt-4 text-3xl font-extrabold text-slate-800">
          안전보건교육
          <br />
          수료 시스템
        </h1>
        <p className="mt-3 text-slate-500">
          공장 출입 전 필수 안전교육을
          <br />
          이수해 주세요.
        </p>
      </div>

      <div className="w-full space-y-3">
        <Link href="/consent" className="btn-primary block text-center">
          처음 수강하기
        </Link>
        <Link href="/lookup" className="btn-secondary block text-center">
          기존 수료 이력 조회
        </Link>
        <Link
          href="/access-pass"
          className="block w-full rounded-xl bg-emerald-500 px-5 py-4 text-base font-bold text-white shadow transition active:scale-95 text-center"
        >
          🪪 출입증 보기
        </Link>
        <Link
          href="/work-permit"
          className="block w-full rounded-xl bg-slate-800 px-5 py-4 text-base font-bold text-white shadow transition active:scale-95 text-center"
        >
          📝 작업허가서 신청
        </Link>
      </div>

      <p className="mt-10 text-xs text-slate-400">
        본 교육은 산업안전보건법에 따른 필수 교육입니다.
        <br />
        수료 유효기간은 6개월입니다.
      </p>
    </main>
  );
}
