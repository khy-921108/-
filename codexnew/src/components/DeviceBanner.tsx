'use client';

import { useDevice } from '@/lib/use-device';

/** 첫 화면 상단: 이 휴대폰이 기억 중이면 누구로 기억됐는지와 [해제] */
export default function DeviceBanner() {
  const { me, revoke } = useDevice();
  if (!me) return null;
  return (
    <div className="mb-4 flex w-full items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm text-emerald-800">
      <span>
        <b>{me.nameMasked}</b> · {me.phoneMasked} · 이 휴대폰 기억 중
      </span>
      <button
        type="button"
        onClick={() => {
          if (confirm('이 휴대폰의 기억을 해제할까요? 다음부터는 이름·생년월일·연락처를 다시 입력해야 합니다.')) revoke();
        }}
        className="shrink-0 rounded-lg border border-emerald-300 bg-white px-3 py-1 text-xs font-bold text-emerald-700"
      >
        해제
      </button>
    </div>
  );
}
