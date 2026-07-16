'use client';

/**
 * 관리자 3화면(작업허가·업체·수료) 공통 숫자 카드 — 클릭 시 해당 항목 필터.
 * 위치·크기·모양 통일용. active = 현재 선택된 필터(파란 테두리).
 */
export default function StatCardButton({
  label,
  value,
  color,
  active,
  onClick,
}: {
  label: string;
  value: number;
  color?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl bg-white border p-3 text-center shadow-sm transition w-full ${
        active ? 'border-brand ring-2 ring-brand/30' : 'border-slate-100 hover:border-slate-300'
      }`}
    >
      <p className="text-[11px] text-slate-500 whitespace-nowrap">{label}</p>
      <p className={`text-lg font-extrabold ${color ?? 'text-slate-800'}`}>{value}</p>
    </button>
  );
}
