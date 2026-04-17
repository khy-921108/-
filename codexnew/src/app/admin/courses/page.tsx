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
  youtubeInput: string;
  duration: number;
  sortOrder: number;
}

const TARGETS = [
  { code: 'TRUCK', label: '화물차' },
  { code: 'WORKER', label: '작업자' },
  { code: 'HEAVY', label: '중장비' },
];

function extractYoutubeId(input: string): string {
  if (!input) return '';
  const match = input.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : input.trim();
}

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
  const [newCourse, setNewCourse] = useState({ title: '', targetType: 'TRUCK', version: 1 });
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

    const isDuplicate = course.course_videos.some((v) => v.youtube_video_id === youtubeId);
    if (isDuplicate) {
      if (!confirm('이미 등록된 영상입니다. 그래도 추가하시겠습니까?')) return;
    }

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
          cons
