'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 디지털 서명 패드 — Pointer Events로 마우스(PC)·터치(폰)·펜 통합 처리.
 */
export default function SignaturePad({
  onChange,
  height = 140,
}: {
  onChange: (dataUrl: string) => void;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasDrawn = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';
    }
  }, [height]);

  const posOf = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    try { canvasRef.current!.setPointerCapture(e.pointerId); } catch { /* */ }
    drawing.current = true;
    last.current = posOf(e);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d');
    if (!ctx || !last.current) return;
    const p = posOf(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasDrawn.current) {
      hasDrawn.current = true;
      setEmpty(false);
    }
  };
  const onUp = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    drawing.current = false;
    last.current = null;
    onChange(hasDrawn.current ? canvasRef.current!.toDataURL('image/png') : '');
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn.current = false;
    setEmpty(true);
    onChange('');
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height,
          touchAction: 'none',
          background: '#fff',
          border: '1px solid #cbd5e1',
          borderRadius: 8,
          display: 'block',
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onPointerCancel={onUp}
      />
      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-slate-400">
          {empty ? '여기에 손가락 또는 마우스로 서명해 주세요' : '✓ 서명 입력됨'}
        </span>
        <button type="button" onClick={clear} className="text-xs text-slate-500 underline">
          지우기
        </button>
      </div>
    </div>
  );
}
