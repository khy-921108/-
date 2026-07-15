'use client';

import { useEffect, useState } from 'react';

/** 홈 공지 배너 — 본문 있으면 표시, [X] 닫기 시 해당 버전(at) localStorage 기록 → 같은 버전 재표시 안 함. */
export default function HomeNotice() {
  const [notice, setNotice] = useState('');
  const [at, setAt] = useState('');
  const [show, setShow] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/home-notice', { cache: 'no-store' });
        const j = await res.json();
        const body = (j?.notice ?? '').trim();
        const ver = j?.at ?? '';
        if (!body) return;
        let dismissed = '';
        try { dismissed = localStorage.getItem('homeNoticeDismissed') ?? ''; } catch { /* */ }
        setNotice(body); setAt(ver);
        if (ver !== dismissed) setShow(true);
      } catch { /* 조용히 무시 */ }
    })();
  }, []);

  if (!show) return null;

  const close = () => {
    try { localStorage.setItem('homeNoticeDismissed', at); } catch { /* */ }
    setShow(false);
  };

  return (
    <div className="w-full rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-left mb-4 relative">
      <button onClick={close} aria-label="공지 닫기" className="absolute top-2 right-2 text-amber-500 hover:text-amber-700 text-lg leading-none px-1">×</button>
      <p className="text-sm font-bold text-amber-800 mb-1">📢 공지</p>
      <p className="text-sm text-slate-700 whitespace-pre-wrap pr-4">{notice}</p>
    </div>
  );
}
