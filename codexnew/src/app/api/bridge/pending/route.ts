/**
 * src/app/api/bridge/pending/route.ts — 승인 대기 목록 (SHE 포털용)
 *
 * [R-2] x-bridge-key == env BRIDGE_KEY 일 때만 응답 (503/401 게이트).
 * - 검토중 업체(status=REVIEW) + 제출된 작업허가(status=SUBMITTED)만.
 * - 개인정보 최소: 업체명·담당자명·신청자명·작업명·날짜 수준. 전화번호 미반환.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store'; // Supabase 조회를 Next Data Cache 에 캐시하지 않음(승인 즉시 반영)

export async function GET(req: Request) {
  const key = process.env.BRIDGE_KEY;
  if (!key) return NextResponse.json({ error: 'BRIDGE_DISABLED' }, { status: 503 });
  if (req.headers.get('x-bridge-key') !== key) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const [companiesRes, permitsRes] = await Promise.all([
    supabase
      .from('companies')
      .select('id, name, biz_no, manager_name, created_at')
      .eq('status', 'REVIEW')
      .order('created_at', { ascending: true }),
    supabase
      .from('work_permits')
      .select('id, permit_number, request_company_name, work_name, applicant_name, work_start')
      .eq('status', 'SUBMITTED')
      .is('issuer_signature', null) // B안: 1차 승인(발급 서명)된 건은 대기목록에서 제외(관리자·포털 공통)
      .order('work_start', { ascending: true }),
  ]);

  const companies = (companiesRes.data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    bizNo: c.biz_no ?? '',
    managerName: c.manager_name ?? '',
    requestedAt: c.created_at,
  }));
  const permits = (permitsRes.data ?? []).map((p: any) => ({
    id: p.id,
    permitNumber: p.permit_number,
    companyName: p.request_company_name,
    workName: p.work_name,
    applicantName: p.applicant_name,
    workDate: p.work_start,
  }));

  return NextResponse.json({ companies, permits });
}
