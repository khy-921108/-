import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { getSignatureStatusForPermits } from '@/lib/safety-doc-status';
import { stageFromRow } from '@/lib/work-permit-stage';

// 목록은 승인·되돌리기로 수시 변하므로 라우트 캐시 금지(과거 stale 캐시 버그 재발 방지 원칙).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const PERMIT_PHOTO_BUCKET = 'work-permit-photos';
const MAX_DELETE = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DELETE /api/admin/work-permits  (권한 WORKPERMITS_APPROVE) — 문자 없는 삭제
 * Body: { ids: string[], reason: string }  (최대 50건, 일괄 삭제도 사유 1회)
 * - 판정·로그·삭제는 SQL 함수 admin_delete_work_permits 한 트랜잭션. 안 맞는 건은 건별 사유 반환.
 * - 🔴 문자·알림 발송 없음. sendSms 를 부르지 말 것.
 * - 서약·이행각서는 건드리지 않음. Storage 사진만 여기서 지운다.
 */
export async function DELETE(req: Request) {
  const auth = await requirePermission('WORKPERMITS_APPROVE');
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids)
    ? Array.from(new Set(body.ids.filter((v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v))))
    : [];
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  if (!reason) {
    return NextResponse.json({ success: false, code: 'NO_REASON', message: '삭제 사유를 입력해 주세요.' }, { status: 400 });
  }
  if (ids.length === 0) {
    return NextResponse.json({ success: false, code: 'NO_TARGET', message: '삭제할 허가서를 선택해 주세요.' }, { status: 400 });
  }
  if (ids.length > MAX_DELETE) {
    return NextResponse.json(
      { success: false, code: 'TOO_MANY', message: `한 번에 최대 ${MAX_DELETE}건까지 삭제할 수 있습니다.` },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('admin_delete_work_permits', {
    p_ids: ids,
    p_reason: reason,
    p_actor: auth.admin.email,
  });

  if (error) {
    console.error('[admin/work-permits DELETE]', error);
    return NextResponse.json(
      { success: false, code: 'DELETE_FAILED', message: '삭제하지 못했습니다. 바뀐 내용은 없습니다.' },
      { status: 500 }
    );
  }

  const r = data as any;
  if (!r?.ok) {
    return NextResponse.json(
      { success: false, code: r?.code ?? 'DELETE_FAILED', message: '삭제하지 못했습니다.' },
      { status: 400 }
    );
  }

  const deleted: { id: string; permitNumber: string }[] = Array.isArray(r.deleted) ? r.deleted : [];
  const refused: { id: string; permitNumber: string | null; reasons: string[] }[] = Array.isArray(r.refused) ? r.refused : [];

  // Storage permits/{id}/ — 있으면 삭제. 실패해도 허가서는 이미 지워졌으므로 로그만 남긴다.
  for (const d of deleted) {
    try {
      const folder = `permits/${d.id}`;
      const { data: files, error: listErr } = await supabase.storage.from(PERMIT_PHOTO_BUCKET).list(folder, { limit: 1000 });
      if (listErr) throw listErr;
      const paths = (files ?? []).map((f) => `${folder}/${f.name}`);
      if (paths.length > 0) {
        const { error: rmErr } = await supabase.storage.from(PERMIT_PHOTO_BUCKET).remove(paths);
        if (rmErr) throw rmErr;
      }
    } catch (e) {
      console.error('[admin/work-permits DELETE] storage:', d.permitNumber, e);
    }
  }

  return NextResponse.json({ success: true, data: { deleted, refused } });
}

/**
 * GET /api/admin/work-permits  (requireAdmin) — 신청 목록
 * res: { success, data:{ items:[{permitId,permitNumber,permitType,companyName,workName,
 *                               applicantName,participantCount,createdAt,status,supplemental}], totalCount } }
 */
export async function GET(req: Request) {
  const auth = await requirePermission('WORKPERMITS_VIEW');
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const keyword = (url.searchParams.get('keyword') ?? '').trim();
  const month = (url.searchParams.get('month') ?? '').trim(); // 조회 월 (YYYY-MM, KST)
  const year = (url.searchParams.get('year') ?? '').trim();   // 조회 년 (YYYY, KST) — 년별 전환

  const supabase = createServiceClient();
  // 겹침 범위(KST): 월별 또는 년별. 조건: work_start <= 범위끝 AND work_end >= 범위시작
  let rangeStart = '';
  let rangeEnd = '';
  if (/^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    rangeStart = `${month}-01T00:00:00+09:00`;
    rangeEnd = `${month}-${String(lastDay).padStart(2, '0')}T23:59:59+09:00`;
  } else if (/^\d{4}$/.test(year)) {
    rangeStart = `${year}-01-01T00:00:00+09:00`;
    rangeEnd = `${year}-12-31T23:59:59+09:00`;
  }

  // 년별 조회는 500건을 넘을 수 있어 페이지네이션으로 전량 조회(누락 방지)
  const permits: any[] = [];
  const size = 1000;
  let from = 0;
  for (;;) {
    let q = supabase
      .from('work_permits')
      .select(
        `id, permit_number, permit_type, request_company_name, work_name, work_start, work_end,
         applicant_name, supplemental, status, approved_by, approved_at, created_at,
         issuer_signature, started_at, completion, tbm, dept_confirmations, equipment_arrivals`
      )
      .order('work_start', { ascending: false });
    if (keyword) {
      const safe = keyword.replace(/[%,]/g, ' ').trim();
      if (safe) {
        q = q.or(
          `permit_number.ilike.%${safe}%,request_company_name.ilike.%${safe}%,work_name.ilike.%${safe}%,applicant_name.ilike.%${safe}%`
        );
      }
    }
    if (rangeStart) q = q.lte('work_start', rangeEnd).gte('work_end', rangeStart);
    const { data, error } = await q.range(from, from + size - 1);
    if (error) {
      console.error('[admin/work-permits] error:', error);
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: error.message },
        { status: 500 }
      );
    }
    if (!data || data.length === 0) break;
    permits.push(...data);
    if (data.length < size) break;
    from += size;
  }

  // 참여자 수 집계
  const ids = (permits ?? []).map((p: any) => p.id);
  const countMap = new Map<string, number>();
  if (ids.length > 0) {
    const { data: parts } = await supabase
      .from('work_permit_participants')
      .select('work_permit_id')
      .in('work_permit_id', ids);
    (parts ?? []).forEach((p: any) => {
      countMap.set(p.work_permit_id, (countMap.get(p.work_permit_id) ?? 0) + 1);
    });
  }

  // 개인서약 서명 상태 일괄 집계 (참여자 ↔ safety_pledges 최신서약 signature)
  let sigMap: Awaited<ReturnType<typeof getSignatureStatusForPermits>> = {};
  try {
    sigMap = await getSignatureStatusForPermits(supabase, ids);
  } catch (e) {
    console.error('[admin/work-permits] signature status:', e);
  }

  const now = Date.now(); // 미종료/기간 경과 판정 기준(렌더 시각)
  const items = (permits ?? []).map((p: any) => {
    const sig = sigMap[p.id] ?? { total: 0, signed: 0, unsigned: 0, unsignedNames: [], participants: [] };
    return {
      permitId: p.id,
      permitNumber: p.permit_number,
      permitType: p.permit_type,
      companyName: p.request_company_name,
      workName: p.work_name,
      workStart: p.work_start,
      workEnd: p.work_end,
      applicantName: p.applicant_name,
      participantCount: countMap.get(p.id) ?? 0,
      supplemental: p.supplemental ?? {},
      status: p.status,
      stage: stageFromRow(p, now), // R-6 진행단계(full-stage — 3분류 탭·상세·업체·포털·print와 동일 판정)
      arrivalsCount: Array.isArray(p.equipment_arrivals) ? p.equipment_arrivals.length : 0, // 장비 도착 건수(⚠ 미등록 표시용)
      approvedBy: p.approved_by ?? null,
      approvedAt: p.approved_at ?? null,
      createdAt: p.created_at,
      signature: {
        total: sig.total,
        signed: sig.signed,
        unsigned: sig.unsigned,
        unsignedNames: sig.unsignedNames,
        participants: sig.participants,
      },
    };
  });

  return NextResponse.json({
    success: true,
    data: { items, totalCount: items.length },
  });
}
