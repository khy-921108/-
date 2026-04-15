'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface Question {
  questionId: number;
  questionNo: number;
  questionText: string;
  options: { no: number; text: string }[];
}

export default function ExamPage() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const sid = sessionStorage.getItem('sessionId');
    if (!sid) {
      router.replace('/');
      return;
    }
    setSessionId(sid);
    loadQuestions(sid);
  }, [router]);

  const loadQuestions = async (sid: string) => {
    try {
      const res = await fetch(`/api/sessions/${sid}/exam`);
      const json = await res.json();
      if (!json.success) {
        setError(json.message || '문제 조회 실패');
        setLoading(false);
        return;
      }
      setQuestions(json.data.questions);
      setLoading(false);
    } catch (e) {
      console.error(e);
      setError('네트워크 오류');
      setLoading(false);
    }
  };

  const select = (qId: number, optNo: number) => {
    setAnswers((prev) => ({ ...prev, [qId]: optNo }));
  };

  const allAnswered = questions.length > 0 && questions.every((q) => answers[q.questionId]);

  const submit = async () => {
    if (!sessionId || !allAnswered) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/exam-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: questions.map((q) => ({
            questionId: q.questionId,
            selectedOption: answers[q.questionId],
          })),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message || '제출 실패');
        setSubmitting(false);
        return;
      }
      sessionStorage.setItem('examResult', JSON.stringify(json.data));
      router.push('/result');
    } catch (e) {
      console.error(e);
      setError('네트워크 오류');
      setSubmitting(false);
    }
  };

  if (loading) return <div className="py-10 text-center text-slate-500">문제 불러오는 중...</div>;

  if (error) {
    return (
      <div className="py-10 text-center">
        <p className="text-red-600">{error}</p>
        <button className="btn-secondary mt-4" onClick={() => router.push('/video')}>
          영상 시청으로 돌아가기
        </button>
      </div>
    );
  }

  return (
    <main className="space-y-5 pb-32">
      <header>
        <p className="text-sm font-semibold text-brand">STEP 4 / 5</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">시험</h1>
        <p className="mt-1 text-sm text-slate-500">
          총 {questions.length}문항. 합격 기준을 충족하면 수료 처리됩니다.
        </p>
      </header>

      <div className="space-y-4">
        {questions.map((q) => (
          <div key={q.questionId} className="card space-y-3">
            <div className="flex items-start gap-2">
              <span className="shrink-0 rounded-full bg-brand text-white text-xs font-bold w-6 h-6 flex items-center justify-center">
                {q.questionNo}
              </span>
              <p className="font-semibold text-slate-800">{q.questionText}</p>
            </div>
            <div className="space-y-2">
              {q.options.map((opt) => {
                const selected = answers[q.questionId] === opt.no;
                return (
                  <button
                    key={opt.no}
                    type="button"
                    onClick={() => select(q.questionId, opt.no)}
                    className={`w-full text-left rounded-xl border-2 px-4 py-3 text-sm transition ${
                      selected
                        ? 'border-brand bg-brand/5 text-brand font-bold'
                        : 'border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    {opt.text}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4">
        <div className="mx-auto max-w-xl">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-slate-500">답변 완료</span>
            <span className="font-bold text-brand">
              {Object.keys(answers).length} / {questions.length}
            </span>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={!allAnswered || submitting}
            className="btn-primary"
          >
            {submitting ? '채점 중...' : '제출하기'}
          </button>
        </div>
      </div>
    </main>
  );
}
