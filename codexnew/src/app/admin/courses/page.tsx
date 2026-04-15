'use client';

import { useEffect, useState } from 'react';

interface CourseVideo {
  id: number;
  title: string;
  youtube_video_id: string;
  duration_sec: number;
  sort_order: number;
}

interface Course {
  id: number;
  title: string;
  version: number;
  is_active: boolean;
  target_types: { code: string; label: string };
  course_videos: CourseVideo[];
}

const TARGETS = [
  { code: 'TRUCK', label: '화물차' },
  { code: 'WORKER', label: '작업자' },
  { code: 'HEAVY', label: '중장비' },
];

export default function AdminCoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);

  // 새 과정 폼
  const [newCourse, setNewCourse] = useState({ title: '', targetType: 'TRUCK', version: 1 });

  // 영상 추가 폼 (과정별)
  const [videoForm, setVideoForm] = useState<Record<number, { title: string; youtubeId: string; duration: number }>>({});

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/admin/courses');
    const json = await res.json();
    if (json.success) setCourses(json.data.items);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const createCourse = async () => {
    if (!newCourse.title.trim()) return;
    const res = await fetch('/api/admin/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'createCourse', ...newCourse }),
    });
    const json = await res.json();
    if (!json.success) {
      alert(json.message ?? '생성 실패');
      return;
    }
    setNewCourse({ title: '', targetType: 'TRUCK', version: 1 });
    load();
  };

  const addVideo = async (courseId: number) => {
    const form = videoForm[courseId];
    if (!form || !form.title || !form.youtubeId) return;
    const res = await fetch('/api/admin/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'addVideo',
        courseId,
        title: form.title,
        youtubeVideoId: form.youtubeId,
        durationSec: form.duration,
        sortOrder: 0,
      }),
    });
    const json = await res.json();
    if (!json.success) return alert(json.message ?? '실패');
    setVideoForm((p) => ({ ...p, [courseId]: { title: '', youtubeId: '', duration: 0 } }));
    load();
  };

  const removeVideo = async (videoId: number) => {
    if (!confirm('영상을 삭제하시겠습니까?')) return;
    await fetch('/api/admin/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'removeVideo', videoId }),
    });
    load();
  };

  const toggleActive = async (courseId: number, current: boolean) => {
    await fetch('/api/admin/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateCourse', courseId, isActive: !current }),
    });
    load();
  };

  return (
    <main className="space-y-5">
      <h1 className="text-xl font-bold text-slate-800">교육 과정 관리</h1>

      <div className="card space-y-3">
        <h2 className="font-bold text-slate-800">새 과정 추가</h2>
        <select
          className="input-base"
          value={newCourse.targetType}
          onChange={(e) => setNewCourse({ ...newCourse, targetType: e.target.value })}
        >
          {TARGETS.map((t) => (
            <option key={t.code} value={t.code}>{t.label}</option>
          ))}
        </select>
        <input
          className="input-base"
          placeholder="과정명 (예: 화물차 기사 2026년 개정)"
          value={newCourse.title}
          onChange={(e) => setNewCourse({ ...newCourse, title: e.target.value })}
        />
        <input
          type="number"
          className="input-base"
          placeholder="버전 번호"
          value={newCourse.version}
          onChange={(e) => setNewCourse({ ...newCourse, version: Number(e.target.value) })}
        />
        <button onClick={createCourse} className="btn-primary">과정 추가</button>
      </div>

      {loading ? (
        <p className="text-center text-slate-500 py-4">불러오는 중...</p>
      ) : (
        courses.map((c) => (
          <div key={c.id} className="card space-y-3">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-bold text-brand">
                  {c.target_types.label} · v{c.version}
                </p>
                <p className="font-bold text-slate-800 mt-0.5">{c.title}</p>
              </div>
              <button
                onClick={() => toggleActive(c.id, c.is_active)}
                className={`text-xs font-bold px-2 py-1 rounded ${
                  c.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {c.is_active ? '✅ 활성' : '⛔ 비활성'}
              </button>
            </div>

            {/* 영상 목록 */}
            <div className="space-y-1.5">
              {c.course_videos.length === 0 && (
                <p className="text-xs text-slate-400">등록된 영상이 없습니다.</p>
              )}
              {c.course_videos
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((v) => (
                  <div key={v.id} className="flex justify-between items-center bg-slate-50 rounded-lg p-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{v.title}</p>
                      <p className="text-xs text-slate-500 font-mono">
                        YT: {v.youtube_video_id} · {v.duration_sec}초
                      </p>
                    </div>
                    <button onClick={() => removeVideo(v.id)} className="text-xs text-red-600 font-bold ml-2">
                      삭제
                    </button>
                  </div>
                ))}
            </div>

            {/* 영상 추가 */}
            <details className="text-sm">
              <summary className="cursor-pointer text-brand font-bold">+ 영상 추가</summary>
              <div className="space-y-2 mt-3">
                <input
                  className="input-base"
                  placeholder="영상 제목"
                  value={videoForm[c.id]?.title ?? ''}
                  onChange={(e) =>
                    setVideoForm((p) => ({
                      ...p,
                      [c.id]: { ...(p[c.id] ?? { youtubeId: '', duration: 0 }), title: e.target.value },
                    }))
                  }
                />
                <input
                  className="input-base font-mono"
                  placeholder="유튜브 영상 ID (예: dQw4w9WgXcQ)"
                  value={videoForm[c.id]?.youtubeId ?? ''}
                  onChange={(e) =>
                    setVideoForm((p) => ({
                      ...p,
                      [c.id]: { ...(p[c.id] ?? { title: '', duration: 0 }), youtubeId: e.target.value },
                    }))
                  }
                />
                <input
                  type="number"
                  className="input-base"
                  placeholder="길이 (초)"
                  value={videoForm[c.id]?.duration ?? ''}
                  onChange={(e) =>
                    setVideoForm((p) => ({
                      ...p,
                      [c.id]: { ...(p[c.id] ?? { title: '', youtubeId: '' }), duration: Number(e.target.value) },
                    }))
                  }
                />
                <button onClick={() => addVideo(c.id)} className="btn-primary">영상 등록</button>
              </div>
            </details>
          </div>
        ))
      )}
    </main>
  );
}
