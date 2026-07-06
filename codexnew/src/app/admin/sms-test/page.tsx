'use client';

/**
 * /admin/sms-test — 알리고 발송 검증용 임시 페이지 (R-5 0단계)
 * ⚠️ 임시: R-5 완료 시 이 페이지와 /api/_debug/aligo-test 라우트를 삭제할 것.
 * SUPER 관리자만 실제 발송됨(라우트가 requireSuperAdmin 로 보호).
 */

import { useState } from 'react';

export default function SmsTestPage() {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');

  const send = async () => {
    setResult('');
    setLoading(true);
    try {
      const res = await fetch('/api/_debug/aligo-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: phone }),
      });
      const json = await res.json();
      if (json.success) {
        setResult(`✅ 발송 성공 (result_code=${json.code}). 폰에서 문자를 확인하세요.`);
      } else {
        setResult(`❌ 실패: ${json.aligoMessage || json.message || '알 수 없는 오류'} (code=${json.code ?? '-'})`);
      }
    } catch (e) {
      setResult(`❌ 요청 오류: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800">📱 문자 발송 테스트 (임시)</h1>
      <div className="card space-y-3">
        <p className="text-sm text-slate-600">
          알리고 발송이 되는지 확인하는 임시 화면입니다. 본인 휴대폰 번호를 넣고 발송해 보세요.
          <br />
          <span className="text-xs text-slate-400">SUPER 관리자만 실제 발송됩니다. R-5 완료 후 이 화면은 제거됩니다.</span>
        </p>
        <div>
          <label className="label">수신 휴대폰 번호</label>
          <input
            className="input-base"
            placeholder="01012345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="numeric"
          />
        </div>
        <button onClick={send} disabled={loading || !phone.trim()} className="btn-primary">
          {loading ? '발송 중...' : '테스트 문자 발송'}
        </button>
        {result && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700 whitespace-pre-wrap">
            {result}
          </div>
        )}
      </div>
    </main>
  );
}
