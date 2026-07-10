/**
 * src/app/api/bridge/today/route.ts — 오늘의 작업 관제판 (SHE 포털용, GET)
 *
 * x-bridge-key 게이트. 오늘(KST) 이 작업기간(work_start~work_end)에 포함되는 허가서를
 *  - ongoing:        아직 최종 종료확인 안 된 것 (현재 단계 라벨 포함)
 *  - completedToday: 오늘 종료확인까지 끝난 것 (종료확인 시각)
 * 로 나눠 반환.
 * 🔴 개인정보(이름·전화·생년월일·서명이미지) 절대 반환 금지 — 서명 컬럼은 단계 판정에만 쓰고 응답에 안 넣음.
 * 🔴 dynamic/force-no-store 필수(브리지 GET Supabase fetch Data Cache 방지).
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { SUPPLEMENTAL_WORKS } from '@/lib/work-permit-constants';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const isSig = (s: any) => !!(s && String(s).startsWith('data:image/'));

export async function GET(req: Request) {
  const key = process.env.BRIDGE_KEY;
  if (!key) return NextResponse.json({ error: 'BRIDGE_DISABLED' }, { status: 503 });
  if (req.headers.get('x-bridge-key') !== key) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = new Date();
  const k = new Date(now.getTime() + 9 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`;
  const todayStart = `${ymd}T00:00:00+09:00`;
  const todayEnd = `${ymd}T23:59:59+09:00`;

  // 오늘이 작업기간에 포함되는 허가서 (서명 컬럼은 단계 판정용, 응답에 미포함)
  const { data: permits, error } = await supabase
    .from('work_permits')
    .select('id, permit_number, request_company_name, supplemental, status, work_start, work_end, issuer_signature, tbm, dept_confirmations, started_at, completion')
    .lte('work_start', todayEnd)
    .gte('work_end', todayStart)
    .order('work_start', { ascending: true })
    .limit(300);

  if (error) {
    console.error('[bridge/today] error:', error);
    return NextResponse.json({ error: 'QUERY_FAILED' }, { status: 500 });
  }

  const workType = (supp: Record<string, string>) => {
    const labels = SUPPLEMENTAL_WORKS.filter((w) => supp?.[w.key] === 'Y').map((w) => w.label);
    return labels.length ? labels.join('·') : '일반위험';
  };
  // ongoing 단계 라벨(종료확인·종료신고·개시 이전)
  const ongoingStage = (p: any): string => {
    const tbm = p.tbm ?? {};
    const dc = p.dept_confirmations ?? {};
    const supp = p.supplemental ?? {};
    const workerConfirmCount = Object.values(tbm.confirmations ?? {}).filter((c: any) => isSig(c?.signature)).length;
    const tbmHasContent = (Array.isArray(tbm.photos) ? tbm.photos.length : 0) > 0 || workerConfirmCount > 0;
    if (!isSig(p.issuer_signature)) return '승인 대기';
    if (!tbmHasContent) return 'TBM 대기';
    if (!isSig(tbm.witness?.signature)) return '2차 대기';
    const maintPending = ['hot', 'electric'].some((mk) => supp[mk] === 'Y' && !isSig(dc[mk]?.signature));
    if (maintPending) return '공무확인 대기';
    return '개시 대기';
  };

  const ongoing: any[] = [];
  const completedToday: any[] = [];
  for (const p of permits ?? []) {
    const comp = (p.completion ?? {}) as any;
    const base = { permitNumber: p.permit_number, companyName: p.request_company_name, workType: workType(p.supplemental ?? {}) };
    if (isSig(comp.confirmSignature)) {
      // 오늘 종료확인된 것만 완료 목록
      const at = comp.confirmAt ? new Date(new Date(comp.confirmAt).getTime() + 9 * 3600 * 1000) : null;
      const atYmd = at ? `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}` : '';
      if (atYmd === ymd) completedToday.push({ ...base, confirmedAt: comp.confirmAt });
      continue;
    }
    let stage: string;
    if (isSig(comp.workerSignature)) stage = '종료확인 대기';
    else if (p.started_at) stage = '작업 중';
    else stage = ongoingStage(p);
    ongoing.push({ ...base, stage });
  }

  return NextResponse.json({ date: ymd, ongoing, completedToday });
}
