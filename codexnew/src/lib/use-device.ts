'use client';

import { useCallback, useEffect, useState } from 'react';

/** 이 휴대폰에 기억된 본인 정보(서버 /api/device/me 응답). 쿠키 자체는 화면에서 읽을 수 없다. */
export interface DeviceMe {
  name: string;
  birthDate: string;
  phone: string;
  nameMasked: string;
  phoneMasked: string;
}

let cache: Promise<DeviceMe | null> | null = null;

async function fetchMe(): Promise<DeviceMe | null> {
  try {
    const res = await fetch('/api/device/me', { cache: 'no-store' });
    const json = await res.json();
    const d = json?.data;
    if (!json?.success || !d?.registered) return null;
    return { name: d.name, birthDate: d.birthDate, phone: d.phone, nameMasked: d.nameMasked, phoneMasked: d.phoneMasked };
  } catch {
    return null;
  }
}

/** 페이지에서 /api/device/me 를 한 번만 읽는다(같은 화면 안 여러 곳이 같은 결과를 쓴다). */
export function useDevice() {
  const [me, setMe] = useState<DeviceMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!cache) cache = fetchMe();
    cache.then((m) => {
      if (!alive) return;
      setMe(m);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    cache = fetchMe();
    const m = await cache;
    setMe(m);
    return m;
  }, []);

  const revoke = useCallback(async () => {
    try {
      await fetch('/api/device/revoke', { method: 'POST' });
    } catch {
      /* 해제 실패해도 화면은 기억 없음으로 */
    }
    cache = Promise.resolve(null);
    setMe(null);
  }, []);

  return { me, loading, refresh, revoke };
}

/** 입력값이 기억된 본인과 같은 사람인지 */
export function isSameAsDevice(
  me: DeviceMe | null,
  v: { name: string; birthDate: string; phone: string }
): boolean {
  return !!me && me.name === v.name.trim() && me.birthDate === v.birthDate && me.phone === v.phone;
}
