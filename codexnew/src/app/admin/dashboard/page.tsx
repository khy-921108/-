'use client';

import { useEffect, useState } from 'react';

interface Stats {
  totalSessions: number;
  completedValid: number;
  inProgress: number;
  failed: number;
  expiresSoon: number;
  expired: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/dashboard')
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setStats(json.data);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="py-10 text-center text-slate-500">불러오는 중...</div>;
  if (!stats) return <div className="py-10 text-center text-red-600">조회 실패</div>;

  const cards = [
    { label: '전체 세션', value: stats.totalSessions, color: 'bg-slate-100 text-slate-800' },
    { label: '유효 수료', value: stats.completedValid, color: 'bg-emerald-50 text-emerald-700' },
    { label: '진행중', value: stats.inProgress, color: 'bg-blue-50 text-blue-700' },
    { label: '불합격', value: stats.failed, color: 'bg-amber-50 text-amber-700' },
    { label: '만료 예정 (30일)', value: stats.expiresSoon, color: 'bg-orange-50 text-orange-700' },
    { label: '만료됨', value: stats.expired, color: 'bg-red-50 text-red-700' },
  ];

  return (
    <main className="space-y-6">
      <h1 className="text-xl font-bold text-slate-800">대시보드</h1>

      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-2xl p-4 ${c.color}`}>
            <p className="text-xs font-semibold opacity-80">{c.label}</p>
            <p className="mt-1 text-3xl font-extrabold">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="card text-sm text-slate-600 space-y-2">
        <p className="font-bold text-slate-800">💡 운영 팁</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>만료 예정 대상자는 30일 이내 재교육을 안내하세요.</li>
          <li>교육 영상 교체 시 새로운 `version`으로 업데이트하면 기존 수료자의 이력은 이전 버전으로 남습니다.</li>
          <li>시험 문제는 대상별로 관리됩니다.</li>
        </ul>
      </div>
    </main>
  );
}
