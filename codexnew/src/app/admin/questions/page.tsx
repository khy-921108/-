'use client';

import { useEffect, useState } from 'react';

interface Question {
  id: number;
  question_text: string;
  option_1: string;
  option_2: string;
  option_3: string;
  option_4: string;
  correct_option: number;
  explanation: string | null;
  is_active: boolean;
  target_types: { code: string; label: string } | null;
}

const TARGETS = [
  { code: '', label: '전체' },
  { code: 'TRUCK', label: '화물차' },
  { code: 'WORKER', label: '작업자' },
  { code: 'HEAVY', label: '중장비' },
];

const emptyForm = {
  id: null as number | null,
  targetType: 'TRUCK',
  questionText: '',
  option1: '',
  option2: '',
  option3: '',
  option4: '',
  correctOption: 1,
  explanation: '',
  isActive: true,
};

export default function AdminQuestionsPage() {
  const [items, setItems] = useState<Question[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(false);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter) params.set('targetType', filter);
    const res = await fetch(`/api/admin/questions?${params.toString()}`);
    const json = await res.json();
    if (json.success) setItems(json.data.items);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const startEdit = (q: Question) => {
    setForm({
      id: q.id,
      targetType: q.target_types?.code ?? 'TRUCK',
      questionText: q.question_text,
      option1: q.option_1,
      option2: q.option_2,
      option3: q.option_3,
      option4: q.option_4,
      correctOption: q.correct_option,
      explanation: q.explanation ?? '',
      isActive: q.is_active,
    });
    setEditing(true);
  };

  const cancel = () => {
    setForm(emptyForm);
    setEditing(false);
  };

  const save = async () => {
    if (!form.questionText.trim()) return;
    const method = form.id ? 'PUT' : 'POST';
    const res = await fetch('/api/admin/questions', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const json = await res.json();
    if (!json.success) {
      alert(json.message ?? '저장 실패');
      return;
    }
    cancel();
    load();
  };

  const remove = async (id: number) => {
    if (!confirm('이 문제를 삭제하시겠습니까?')) return;
    const res = await fetch(`/api/admin/questions?id=${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) load();
  };

  return (
    <main className="space-y-5">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-bold text-slate-800">시험문제 관리</h1>
        {!editing && (
          <button onClick={() => setEditing(true)} className="bg-brand text-white px-3 py-2 rounded-lg text-sm font-bold">
            + 새 문제
          </button>
        )}
      </div>

      <select
        className="input-base"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      >
        {TARGETS.map((t) => (
          <option key={t.code} value={t.code}>
            대상: {t.label}
          </option>
        ))}
      </select>

      {editing && (
        <div className="card space-y-3">
          <h2 className="font-bold text-slate-800">{form.id ? '문제 수정' : '새 문제'}</h2>
          <select
            className="input-base"
            value={form.targetType}
            onChange={(e) => setForm({ ...form, targetType: e.target.value })}
          >
            {TARGETS.filter((t) => t.code).map((t) => (
              <option key={t.code} value={t.code}>{t.label}</option>
            ))}
          </select>
          <textarea
            className="input-base min-h-[80px]"
            placeholder="문제 내용"
            value={form.questionText}
            onChange={(e) => setForm({ ...form, questionText: e.target.value })}
          />
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="flex gap-2 items-center">
              <input
                type="radio"
                checked={form.correctOption === n}
                onChange={() => setForm({ ...form, correctOption: n })}
                className="h-5 w-5 accent-brand"
              />
              <input
                className="input-base"
                placeholder={`선택지 ${n}`}
                value={(form as any)[`option${n}`]}
                onChange={(e) => setForm({ ...form, [`option${n}`]: e.target.value })}
              />
            </div>
          ))}
          <textarea
            className="input-base"
            placeholder="오답 해설 (선택)"
            value={form.explanation}
            onChange={(e) => setForm({ ...form, explanation: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              className="h-4 w-4 accent-brand"
            />
            활성화
          </label>
          <div className="flex gap-2">
            <button onClick={save} className="btn-primary">저장</button>
            <button onClick={cancel} className="btn-secondary">취소</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs text-slate-500">총 {items.length}문항</p>
        {items.map((q) => (
          <div key={q.id} className="card space-y-2">
            <div className="flex justify-between">
              <span className="text-xs font-bold text-brand">{q.target_types?.label}</span>
              <span className="text-xs">{q.is_active ? '✅ 활성' : '⛔ 비활성'}</span>
            </div>
            <p className="font-semibold text-slate-800">{q.question_text}</p>
            <ol className="text-sm text-slate-600 list-decimal pl-5 space-y-0.5">
              {[q.option_1, q.option_2, q.option_3, q.option_4].map((o, i) => (
                <li key={i} className={q.correct_option === i + 1 ? 'font-bold text-green-700' : ''}>
                  {o} {q.correct_option === i + 1 && '✓'}
                </li>
              ))}
            </ol>
            {q.explanation && (
              <p className="text-xs text-slate-500 bg-slate-50 rounded p-2">💡 {q.explanation}</p>
            )}
            <div className="flex gap-2">
              <button onClick={() => startEdit(q)} className="text-sm text-brand font-bold">수정</button>
              <button onClick={() => remove(q.id)} className="text-sm text-red-600 font-bold">삭제</button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
