'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  youtubeId: string;
  completeRate: number; // %
  onProgress: (progressRate: number, watchedSec: number) => void;
  onComplete: () => void;
  initialProgress?: number;
}

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

/**
 * 유튜브 시청률 감지 컴포넌트.
 * - 1초마다 현재 재생 위치를 Set에 기록 (스킵 방지)
 * - 진행률 = 실제 시청한 초 / 영상 전체 초
 * - completeRate 도달 시 onComplete 1회 호출
 */
export default function VideoPlayer({
  youtubeId,
  completeRate,
  onProgress,
  onComplete,
  initialProgress = 0,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const watchedSecondsRef = useRef<Set<number>>(new Set());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const durationRef = useRef<number>(0);
  const completedRef = useRef<boolean>(false);
  const [progress, setProgress] = useState<number>(initialProgress);

  useEffect(() => {
    // API 스크립트 로드
    if (!document.getElementById('youtube-iframe-api')) {
      const tag = document.createElement('script');
      tag.id = 'youtube-iframe-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }

    const initPlayer = () => {
      if (!containerRef.current || !window.YT || !window.YT.Player) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId: youtubeId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          disablekb: 1,
        },
        events: {
          onReady: (ev: any) => {
            durationRef.current = ev.target.getDuration();
          },
          onStateChange: handleStateChange,
        },
      });
    };

    const handleStateChange = (ev: any) => {
      const YT = window.YT;
      if (!YT) return;
      if (ev.data === YT.PlayerState.PLAYING) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => {
          const cur = Math.floor(playerRef.current.getCurrentTime());
          watchedSecondsRef.current.add(cur);
          const dur = durationRef.current || playerRef.current.getDuration();
          if (dur > 0) {
            const rate = Math.round((watchedSecondsRef.current.size / dur) * 100);
            setProgress(rate);
            onProgress(rate, watchedSecondsRef.current.size);
            if (!completedRef.current && rate >= completeRate) {
              completedRef.current = true;
              onComplete();
            }
          }
        }, 1000);
      } else {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }

      if (ev.data === YT.PlayerState.ENDED) {
        const dur = durationRef.current || playerRef.current.getDuration();
        const rate = dur > 0 ? Math.round((watchedSecondsRef.current.size / dur) * 100) : 0;
        if (!completedRef.current && rate >= completeRate) {
          completedRef.current = true;
          onComplete();
        }
      }
    };

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (playerRef.current?.destroy) playerRef.current.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeId]);

  return (
    <div className="space-y-3">
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
        <div ref={containerRef} className="w-full h-full" />
      </div>
      <div>
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>시청 진행률</span>
          <span className="font-bold text-brand">{progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
          <div
            className="h-full bg-brand transition-all"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-slate-400">
          ※ 영상을 건너뛰면 진행률이 오르지 않습니다. {completeRate}% 이상 시청해야 완료됩니다.
        </p>
      </div>
    </div>
  );
}
