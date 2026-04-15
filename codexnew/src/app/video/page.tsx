'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import VideoPlayer from '@/components/VideoPlayer';

interface VideoItem {
  id: number;
  title: string;
  youtube_video_id: string;
  duration_sec: number;
  sort_order: number;
  progressRate: number;
  completedYn: boolean;
}

const COMPLETE_RATE = 95; // 서버 설정과 일치

export default function VideoPage() {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [courseTitle, setCourseTitle] = useState('');
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const sid = sessionStorage.getItem('sessionId');
    if (!sid) {
      router.replace('/');
      return;
    }
    setSessionId(sid);
    loadCourse(sid);
  }, [router]);

  const loadCourse = async (sid: string) => {
    try {
      const res = await fetch(`/api/sessions/${sid}/course`);
      const json = await res.json();
      if (!json.success) {
        setError(json.message || '교육 과정 조회 실패');
        setLoading(false);
        return;
      }
      setCourseTitle(json.data.course?.title ?? '');
      setVideos(json.data.videos ?? []);
      // 완료되지 않은 첫 영상으로 이동
      const firstIncomplete = json.data.videos.findIndex((v: VideoItem) => !v.completedYn);
      setCurrentIdx(firstIncomplete < 0 ? json.data.videos.length - 1 : firstIncomplete);
      setLoading(false);
    } catch (e) {
      console.error(e);
      setError('네트워크 오류');
      setLoading(false);
    }
  };

  const saveProgress = async (videoId: number, rate: number, watchedSec: number) => {
    if (!sessionId) return;
    try {
      await fetch(`/api/sessions/${sessionId}/watch-logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseVideoId: videoId,
          progressRate: rate,
          watchedSec,
        }),
      });
    } catch (e) {
      console.error(e);
    }
  };

  // 진행률은 너무 자주 저장하지 않도록 5초마다만 동기화
  const [lastSaved, setLastSaved] = useState<number>(0);
  const handleProgress = (videoId: number, rate: number, watchedSec: number) => {
    const now = Date.now();
    if (now - lastSaved > 5000 || rate === 100) {
      saveProgress(videoId, rate, watchedSec);
      setLastSaved(now);
    }
  };

  const handleComplete = async (videoId: number) => {
    await saveProgress(videoId, 100, videos[currentIdx]?.duration_sec ?? 0);
    // 상태 갱신
    setVideos((prev) =>
      prev.map((v, i) => (i === currentIdx ? { ...v, completedYn: true, progressRate: 100 } : v))
    );
  };

  const allCompleted = videos.length > 0 && videos.every((v) => v.completedYn);

  const goNextVideo = () => {
    if (currentIdx < videos.length - 1) setCurrentIdx(currentIdx + 1);
  };

  const goExam = () => {
    router.push('/exam');
  };

  if (loading) {
    return <div className="py-10 text-center text-slate-500">불러오는 중...</div>;
  }

  if (error) {
    return (
      <div className="py-10 text-center text-red-600">
        <p>{error}</p>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="py-10 text-center text-slate-500">
        등록된 교육 영상이 없습니다. 관리자에게 문의하세요.
      </div>
    );
  }

  const current = videos[currentIdx];

  return (
    <main className="space-y-5">
      <header>
        <p className="text-sm font-semibold text-brand">STEP 3 / 5</p>
        <h1 className="mt-1 text-xl font-bold text-slate-800">{courseTitle}</h1>
        <p className="mt-1 text-sm text-slate-500">
          영상을 끝까지 시청해야 시험에 응시할 수 있습니다.
        </p>
      </header>

      {/* 영상 탭 */}
      {videos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {videos.map((v, i) => (
            <button
              key={v.id}
              onClick={() => setCurrentIdx(i)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition ${
                i === currentIdx
                  ? 'bg-brand text-white'
                  : v.completedYn
                    ? 'bg-brand/10 text-brand'
                    : 'bg-slate-100 text-slate-500'
              }`}
            >
              {v.completedYn ? '✓ ' : ''}
              {i + 1}. {v.title}
            </button>
          ))}
        </div>
      )}

      <div className="card">
        <h2 className="mb-3 font-bold text-slate-800">{current.title}</h2>
        <VideoPlayer
          key={current.id}
          youtubeId={current.youtube_video_id}
          completeRate={COMPLETE_RATE}
          initialProgress={current.progressRate}
          onProgress={(rate, sec) => handleProgress(current.id, rate, sec)}
          onComplete={() => handleComplete(current.id)}
        />
      </div>

      <div className="space-y-3">
        {current.completedYn && currentIdx < videos.length - 1 && (
          <button type="button" onClick={goNextVideo} className="btn-primary">
            다음 영상 시청
          </button>
        )}

        {allCompleted && (
          <button type="button" onClick={goExam} className="btn-primary">
            시험 응시하러 가기
          </button>
        )}
      </div>
    </main>
  );
}
