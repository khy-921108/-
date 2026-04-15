'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Review {
  questionText: string;
  options: string[];
  selectedOption: number;
  correctOption: number;
  isCorrect: boolean;
  explanation: string | null;
}

interface ExamResult {
  examResultId: string;
  score: number;
  totalQuestions: number;
  passThreshold: number;
  passedYn: boolean;
  attemptNumber: number;
  reviews: Review[];
}

export default function ResultPage() {
  const router = useRouter();
  const [result, setResult] = useState<ExamResult | null>(null);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const raw = sessionStorage.getItem('examResult');
    if (!raw) {
      router.replace('/');
      return;
    }
    setResult(JSON.parse(raw));
  }, [router]);

  const complete = async () => {
    const sessionId = sessionStorage.getItem('sessionId');
    if (!sessionId) return;
    setCompleting(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/complete`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message || '수료 처리 실패');
        setCompleting(false);
        return;
      }
      sessionStorage.setItem('completion', JSON.stringify(json.data));
      router.push('/certificate');
    } catch (e) {
      console.error(e);
      setError('네트워크 오류');
      setCompleting(false);
    }
  };

  const retry = () => {
    sessionStorage.removeItem('examResult');
    router.push('/exam');
  };

  if (!result) return null;

  const wrong = result.reviews.filter((r) => !r.isCorrect);

  if (result.passedYn) {
    return (
      <main className="space-y-5 text-center py-8">
        <div className="text-6xl">🎉</div>
        <h1 className="text-2xl font-extrabold text-brand">합격!</h1>
        <p className="text-slate-600">
          {result.totalQuestions}문항 중 <b>{result.score}문항</b> 정답
        </p>

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <button type="button" onClick={complete} disabled={completing} className="btn-primary">
          {completing ? '수료 처리 중...' : '수료증 발급받기'}
        </button>
      </main>
    );
  }

  return (
    <main className="space-y-5 pb-10">
      <header className="text-center py-4">
        <div className="text-5xl">❌</div>
        <h1 className="mt-2 text-2xl font-extrabold text-red-600">불합격</h1>
        <p className="mt-1 text-slate-600">
          {result.totalQuestions}문항 중 <b>{result.score}문항</b> 정답
          <br />
          합격 기준: <b>{result.passThreshold}문항 이상</b>
        </p>
      </header>

      {wrong.length > 0 && (
        <section>
          <h2 className="mb-3 font-bold text-slate-800">오답 확인</h2>
          <div className="space-y-3">
            {wrong.map((r, i) => (
              <div key={i} className="card space-y-2">
                <p className="font-semibold text-slate-800">{r.questionText}</p>
                <div className="text-sm space-y-1">
                  <p className="text-red-600">
                    내 답: {r.options[r.selectedOption - 1]}
                  </p>
                  <p className="text-green-700">
                    정답: {r.options[r.correctOption - 1]}
                  </p>
                </div>
                {r.explanation && (
                  <p className="text-xs text-slate-500 bg-slate-50 rounded p-2">
                    💡 {r.explanation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <button type="button" onClick={retry} className="btn-primary">
        다시 응시하기
      </button>
    </main>
  );
}
