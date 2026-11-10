'use client';

import { useEffect, useRef, useState } from 'react';
import { maskPhone } from '@/lib/format';

type Identity = { name: string; birthDate: string; phone: string };

/** 카카오톡 안 브라우저는 쿠키를 오래 두지 않아 기억이 되지 않는다. */
function isKakaoInApp() {
  return typeof navigator !== 'undefined' && /KAKAOTALK/i.test(navigator.userAgent);
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

/** 문자 인증 없이 바로 기억 등록(교육 등록처럼 방금 문자 인증을 한 경우). 실패는 조용히 넘긴다. */
export async function registerDeviceNow(identity: Identity): Promise<boolean> {
  try {
    const json = await postJson('/api/device/register', identity);
    return !!json?.success;
  } catch {
    return false;
  }
}

/**
 * "이 휴대폰 기억하기" 체크박스 + 문자 인증 창.
 * - checkbox: 본인 입력칸 아래에 둔다(기본 꺼짐). 카카오톡 안에서는 안내 문구로 대신한다.
 * - run(identity): 체크돼 있으면 그 번호로 문자 인증 → 기억 등록. 건너뛰거나 실패해도 원래 동작은 계속한다.
 * - dialog: 화면 어디에 두어도 되는 문자 인증 창(form 바깥에 둘 것).
 */
export function useRememberDevice() {
  const [checked, setChecked] = useState(false);
  const [kakao, setKakao] = useState(false);
  const [dlg, setDlg] = useState<null | { identity: Identity; code: string; busy: boolean; error: string; sent: boolean }>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  useEffect(() => {
    setKakao(isKakaoInApp());
  }, []);

  const finish = (ok: boolean) => {
    const r = resolver.current;
    resolver.current = null;
    setDlg(null);
    r?.(ok);
  };

  const send = async (identity: Identity) => {
    setDlg((d) => (d ? { ...d, busy: true, error: '' } : d));
    try {
      const json = await postJson('/api/verify-phone/send', { phone: identity.phone });
      if (!json?.success) {
        setDlg((d) => (d ? { ...d, busy: false, error: json?.message || '문자를 보내지 못했습니다.' } : d));
        return;
      }
      setDlg((d) => (d ? { ...d, busy: false, sent: true, code: '' } : d));
    } catch {
      setDlg((d) => (d ? { ...d, busy: false, error: '네트워크 오류입니다.' } : d));
    }
  };

  const run = (identity: Identity): Promise<boolean> => {
    if (!checked || kakao) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setDlg({ identity, code: '', busy: true, error: '', sent: false });
      send(identity);
    });
  };

  const confirm = async () => {
    if (!dlg) return;
    if (dlg.code.length !== 6) {
      setDlg({ ...dlg, error: '인증번호 6자리를 입력해 주세요.' });
      return;
    }
    setDlg({ ...dlg, busy: true, error: '' });
    try {
      const c = await postJson('/api/verify-phone/confirm', { phone: dlg.identity.phone, code: dlg.code });
      if (!c?.success) {
        setDlg((d) => (d ? { ...d, busy: false, error: c?.message || '인증에 실패했습니다.' } : d));
        return;
      }
      const r = await postJson('/api/device/register', dlg.identity);
      if (!r?.success) {
        setDlg((d) => (d ? { ...d, busy: false, error: r?.message || '기억하지 못했습니다.' } : d));
        return;
      }
      finish(true);
    } catch {
      setDlg((d) => (d ? { ...d, busy: false, error: '네트워크 오류입니다.' } : d));
    }
  };

  const checkbox = kakao ? (
    <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
      카카오톡 안에서는 기억되지 않습니다. 오른쪽 위 메뉴에서 다른 브라우저로 열어 주세요.
    </p>
  ) : (
    <label className="flex items-start gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        name="remember_device"
        className="mt-0.5"
        checked={checked}
        onChange={(e) => setChecked(e.target.checked)}
      />
      <span>
        이 휴대폰 기억하기(90일)
        <span className="block text-xs text-slate-500">본인 휴대폰일 때만 체크하세요.</span>
      </span>
    </label>
  );

  const dialog = dlg ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 shadow-xl" role="dialog" aria-label="휴대폰 기억하기 인증">
        <h2 className="text-base font-bold text-slate-800">이 휴대폰 기억하기</h2>
        <p className="text-sm text-slate-600">
          {maskPhone(dlg.identity.phone)} 로 보낸 인증번호를 입력하면 90일 동안 이 휴대폰에서 다시 입력하지 않아도 됩니다.
        </p>
        <input
          type="tel"
          name="remember_otp"
          autoComplete="one-time-code"
          inputMode="numeric"
          className="input-base text-center text-xl font-bold tracking-[0.4em]"
          value={dlg.code}
          onChange={(e) => setDlg({ ...dlg, code: e.target.value.replace(/[^0-9]/g, '').slice(0, 6) })}
          placeholder="인증번호 6자리"
          disabled={!dlg.sent}
        />
        {dlg.error && <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{dlg.error}</div>}
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => finish(false)} disabled={dlg.busy}>
            기억하지 않고 계속
          </button>
          <button type="button" className="btn-primary" onClick={confirm} disabled={dlg.busy || !dlg.sent}>
            {dlg.busy ? '처리 중…' : '확인'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return { checked, kakao, checkbox, dialog, run };
}
