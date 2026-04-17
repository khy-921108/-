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

interface VideoFormState {
  title: string;
  youtubeInput: string;   // 사용자가 붙여넣은 원본 (URL 또는 ID)
  duration: number;
  sortOrder: number;
}

const TARGETS = [
  { code: 'TRUCK', label: '화물차' },
  { code: 'WORKER', label: '작업자' },
  { code: 'HEAVY', label: '중장비' },
];

/**
 * 유튜브 URL 또는 11자 ID에서 영상 ID만 추출.
 * - https://www.youtube.com/watch?v=DJWXc--CM_M → DJWXc--CM_M
 * - https://youtu.be/DJWXc--CM_M                 → DJWXc--CM_M
 * - https://www.youtube.com/embed/DJWXc--CM_M    → DJWXc--CM_M
 * - https://www.youtube.com/shorts/DJWXc--CM_M   → DJWXc--CM_M
 * - DJWXc--CM_M                                  → DJWXc--CM_M (그대로)
 * 매칭 실패 시 입력값을 trim한 것을 반환(운영자가 이상한 문자열을 넣었을 때도 입력값 유지).
 */
function extractYoutubeId(input: string): string {
  if (!input) return '';
  const match = input.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : input.trim();
}

/** 추출된 값이 정확히 11자의 유튜브 영상 ID 형식인지 검사 */
function isValidYoutubeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

const EMPTY_VIDEO_FORM: VideoFormState = {
  title: '',
  youtubeInput: '',
  duration: 0,
  sortOrder: 1,
};

export default function AdminCoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);

  // 새 과정 폼
  const [newCourse, setNewCourse] = useState({ title: '', targetType: 'TRUCK', version: 1 });

  // 영상 추가 폼 (과정별)
  const [videoForm, setVideoForm] = useState<Record<number, VideoFormState>>({});

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

  const updateVideoForm = (courseId: number, patch: Partial<VideoFormState>) => {
    setVideoForm((p) => ({
      ...p,
      [courseId]: { ...EMPTY_VIDEO_FORM, ...(p[courseId] ?? {}), ...patch },
    }));
  };

  const addVideo = async (course: Course) => {
    const form = videoForm[course.id];
    if (!form) return;

    const youtubeId = extractYoutubeId(form.youtubeInput);

    // 입력 검증
    if (!form.title.trim()) {
      alert('영상 제목을 입력하세요.');
      return;
    }
    if (!isValidYoutubeId(youtubeId)) {
      alert('유효한 유튜브 URL 또는 11자 영상 ID를 입력하세요.');
      return;
    }
    if (!form.duration || form.duration <= 0) {
      alert('영상 길이(초)를 입력하세요.');
      return;
    }
    if (!form.sortOrder || form.sortOrder < 1) {
      alert('재생 순서는 1 이상이어야 합니다.');
      return;
    }

    // 같은 과정에 동일 ID가 이미 있으면 경고
    const isDuplicate = course.course_videos.some((v) => v.youtube_video_id === youtubeId);
    if (isDuplicate) {
      if (!confirm('이미 등록된 영상입니다. 그래도 추가하시겠습니까?')) return;
    }

    // 같은 과정에 동일 순서가 이미 있으면 경고
    const hasSameOrder = course.course_videos.some((v) => v.sort_order === form.sortOrder);
    if (hasSameOrder) {
      if (!confirm(`이미 순서 ${form.sortOrder}번에 다른 영상이 있습니다. 그래도 추가하시겠습니까?`)) return;
    }

    const res = await fetch('/api/admin/courses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'addVideo',
        courseId: course.id,
        title: form.title,
        youtubeVideoId: youtubeId,
        durationSec: form.duration,
        sortOrder: form.sortOrder,
      }),
    });
    const json = await res.json();
    if (!json.success) return alert(json.message ?? '실패');

    // 등록 성공 → 폼 초기화 (순서는 다음 번호로 자동 증가)
    setVideoForm((p) => ({
      ...p,
      [course.id]: { ...EMPTY_VIDEO_FORM, sortOrder: form.sortOrder + 1 },
    }));
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
        courses.map((c) => {
          const form = videoForm[c.id] ?? EMPTY_VIDEO_FORM;
          const extractedId = extractYoutubeId(form.youtubeInput);
          const isValidId = isValidYoutubeId(extractedId);
          const isDuplicate = isValidId && c.course_videos.some((v) => v.youtube_video_id === extractedId);
          const nextSuggestedOrder = (c.course_videos.reduce((max, v) => Math.max(max, v.sort_order), 0) || 0) + 1;

          return (
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
                  .slice()
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((v) => (
                    <div key={v.id} className="flex justify-between items-center bg-slate-50 rounded-lg p-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          <span className="inline-block w-6 text-brand font-bold">{v.sort_order}.</span>
                          {v.title}
                        </p>
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
                <summary
                  className="cursor-pointer text-brand font-bold"
                  onClick={() => {
                    // 폼이 비어있으면 다음 순서 번호를 자동으로 제안
                    if (!videoForm[c.id]) {
                      updateVideoForm(c.id, { sortOrder: nextSuggestedOrder });
                    }
                  }}
                >
                  + 영상 추가
                </summary>
                <div className="space-y-2 mt-3">
                  <label className="block">
                    <span className="text-xs font-bold text-slate-600">영상 제목</span>
                    <input
                      className="input-base mt-1"
                      placeholder="예: 보호구 지급 및 착용"
                      value={form.title}
                      onChange={(e) => updateVideoForm(c.id, { title: e.target.value })}
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs font-bold text-slate-600">
                      유튜브 URL 또는 영상 ID
                    </span>
                    <input
                      className="input-base mt-1 font-mono"
                      placeholder="https://www.youtube.com/watch?v=... 또는 11자 ID"
                      value={form.youtubeInput}
                      onChange={(e) => updateVideoForm(c.id, { youtubeInput: e.target.value })}
                    />
                    {form.youtubeInput && (
                      <div className="mt-1.5 text-xs space-y-0.5">
                        {isValidId ? (
                          <>
                            <p className="text-emerald-700">
                              ✅ 추출된 영상 ID: <span className="font-mono font-bold">{extractedId}</span>
                            </p>
                            <a
                              href={`https://www.youtube.com/watch?v=${extractedId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-brand underline"
                            >
                              🔗 유튜브에서 미리보기
                            </a>
                            {isDuplicate && (
                              <p className="text-amber-700 font-semibold">
                                ⚠️ 이 과정에 이미 등록된 영상입니다.
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-red-600">
                            ❌ 유튜브 URL 또는 11자 영상 ID 형식이 아닙니다.
                          </p>
                        )}
                      </div>
                    )}
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="text-xs font-bold text-slate-600">길이 (초)</span>
                      <input
                        type="number"
                        className="input-base mt-1"
                        placeholder="예: 200"
                        value={form.duration || ''}
                        onChange={(e) => updateVideoForm(c.id, { duration: Number(e.target.value) })}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold text-slate-600">재생 순서</span>
                      <input
                        type="number"
                        min={1}
                        className="input-base mt-1"
                        placeholder="1, 2, 3..."
                        value={form.sortOrder || ''}
                        onChange={(e) => updateVideoForm(c.id, { sortOrder: Number(e.target.value) })}
                      />
                    </label>
                  </div>

                  <button onClick={() => addVideo(c)} className="btn-primary">
                    영상 등록
                  </button>
                </div>
              </details>
            </div>
          );
        })
      )}
    </main>
  );
}
