/**
 * src/app/api/egress-ip/route.ts — Vercel 서버 아웃바운드 IP 확인용 임시 라우트 (R-5 0단계 진단)
 * ⚠️ 임시: 알리고 IP 이슈 진단용. 확인 후 삭제.
 * 서버에서 외부 IP 에코 서비스를 호출해 이 함수의 "나가는 IP"를 반환.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET() {
  try {
    const res = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    return NextResponse.json({ ip: (j as { ip?: string })?.ip ?? null, region: process.env.VERCEL_REGION ?? null });
  } catch (e) {
    return NextResponse.json({ ip: null, error: (e as Error)?.message ?? 'FAILED' });
  }
}
