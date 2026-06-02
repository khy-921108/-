import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { getSignatureStatusForPermits } from '@/lib/safety-doc-status';

/**
 * GET /api/admin/work-permits  (requireAdmin) — 신청 목록
 * res: { success, data:{ items:[{permitId,permitNumber,permitType,companyName,workName,
 *                               applicantName,participantCount,createdAt,status,supplemental}], totalCount } }
 */
export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const keyword = (url.searchParams.get('keyword') ?? '').trim();
  const dateFrom = (url.searchParams.get('dateFrom') ?? '').tr
