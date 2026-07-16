'use client';

/**
 * 사업자번호 입력칸(공개 등록·관리자 모달 공용).
 * 숫자만 쳐도 000-00-00000 자동 하이픈 + 체크섬 즉시 검사(불가능한 번호 빨간 안내)
 * + [검증] 버튼 → /api/bizno-check (체크섬 통과 시 국세청 상태조회, 키는 서버에만).
 */

import { useState } from 'react';
import { formatBizNo, isValidBizNo, bizNoDigits } from '@/lib/bizno';

export default function BizNoField({
  value,
  onChange,
  label = '사업자번호',
  required = false,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  required?: boolean;
}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const digits = bizNoDigits(value);
  const checksumFail = digits.length === 10 && !isValidBizNo(value);
  const incomplete = digits.length > 0 && digits.length < 10;

  const verify = async () => {
    setResult(null);
    if (!isValidBizNo(value)) {
      setResult({ ok: false, text: '형식상 불가능한 사업자번호입니다.' });
      return;
    }
    setChecking(true);
    try {
      const res = await fetch('/api/bizno-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bizNo: value }),
      });
      const j = await res.json();
      const d = j?.data;
      if (!d) { setResult({ ok: false, text: '검증 실패 — 잠시 후 다시 시도해 주세요.' }); return; }
      if (!d.valid) { setResult({ ok: false, text: d.label }); return; }
      if (!d.checked) { setResult({ ok: true, text: `☑ ${d.label}` }); return; }
      const icon = d.status === '01' ? '✅' : d.status === '02' ? '⚠️' : d.status === '03' ? '⛔' : '❌';
      setResult({ ok: d.status === '01', text: `${icon} ${d.label}` });
    } catch {
      setResult({ ok: false, text: '네트워크 오류 — 잠시 후 다시 시도해 주세요.' });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div>
      <label className="label">{label}{required ? ' *' : ''}</label>
      <div className="flex gap-2">
        <input
          className={`input-base flex-1 min-w-0 ${checksumFail ? 'border-red-400' : ''}`}
          inputMode="numeric"
          placeholder="000-00-00000"
          value={value}
          onChange={(e) => { onChange(formatBizNo(e.target.value)); setResult(null); }}
        />
        <button
          type="button"
          onClick={verify}
          disabled={checking || digits.length !== 10 || checksumFail}
          className="shrink-0 whitespace-nowrap rounded-xl border-2 border-brand text-brand text-sm font-bold px-4 disabled:opacity-40"
        >{checking ? '확인 중…' : '검증'}</button>
      </div>
      {checksumFail && <p className="mt-1 text-xs text-red-600 font-bold">형식상 불가능한 사업자번호입니다. 다시 확인해 주세요.</p>}
      {incomplete && !checksumFail && <p className="mt-1 text-xs text-slate-400">10자리를 입력하면 검증할 수 있습니다.</p>}
      {result && <p className={`mt-1 text-xs font-bold ${result.ok ? 'text-emerald-700' : 'text-red-600'}`}>{result.text}</p>}
    </div>
  );
}
