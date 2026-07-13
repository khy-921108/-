import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/equipment';
import { isValidSignature } from '@/lib/upload-validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 30;

/**
 * POST /api/work-permits/:id/complete-report  (공개, 본인확인 게이트)
 * 업체(신청인/소장)가 직접 작업 종료신고 → completion.workerSignature 저장.
 *  - 관리자 대리 종료신고(complete_report)와 **동일 필드** 사용 → xlsx·print 종료란에 자연 반영.
 *  - 본인확인(이름+생년월일+전화) 통과자만. 허가서 id만으로 아무나 신고 불가.
 *  - 작업개시(started_at) 후에만. 이미 종료신고/종료확인된 건은 거부.
 *  - 종료확인(최종)은 안전환경(관리자)만 — 여기서 하지 않음.
 */
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const permitId = ctx.params.id;
  try {
    let body: any;
    try { body = await req.json(); } catch {
      return NextResponse.json({ success: false, code: 'BAD_REQUEST', message: '잘못된 요청입니다.' }, { status: 400 });
    }
    const name = (body?.name ?? '').toString().trim();
    const birthDate = (body?.birthDate ?? '').toString().trim();
    const phone = (body?.phone ?? '').toString().replace(/[^0-9]/g, '');
    const signature = (body?.signature ?? '').toString();
    const restoreState = typeof body?.restoreState === 'string' ? body.restoreState.trim() : '';

    if (!name || !birthDate || phone.length < 10) {
      return NextResponse.json({ success: false, code: 'INVALID_INPUT', message: '본인확인 정보를 정확히 입력해 주세요.' }, { status: 400 });
    }
    if (!isValidSignature(signature)) {
      return NextResponse.json({ success: false, code: 'SIGNATURE_REQUIRED', message: '신고자(현장소장) 서명이 필요합니다.' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: permit, error } = await supabase
      .from('work_permits')
      .select('id, permit_number, applicant_name, applicant_birth_date, applicant_phone, started_at, completion')
      .eq('id', permitId)
      .maybeSingle();
    if (error) {
      console.error('[complete-report] read:', error);
      return NextResponse.json({ success: false, code: 'QUERY_FAILED', message: '조회 오류' }, { status: 500 });
    }
    if (!permit) {
      return NextResponse.json({ success: false, code: 'NOT_FOUND', message: '작업허가를 찾을 수 없습니다.' }, { status: 404 });
    }

    const isApplicant =
      (permit.applicant_name ?? '').trim() === name &&
      (permit.applicant_birth_date ?? '') === birthDate &&
      normalizePhone(permit.applicant_phone) === normalizePhone(phone);
    if (!isApplicant) {
      return NextResponse.json({ success: false, code: 'NOT_APPLICANT', message: '본인이 신청한 작업허가만 종료신고할 수 있습니다.' }, { status: 403 });
    }

    if (!permit.started_at) {
      return NextResponse.json({ success: false, code: 'NOT_STARTED', message: '작업 개시 승인 후에 종료신고할 수 있습니다.' }, { status: 409 });
    }
    const comp = (permit.completion ?? {}) as Record<string, any>;
    const isSig = (s: any) => !!(s && String(s).startsWith('data:image/'));
    if (isSig(comp.confirmSignature)) {
      return NextResponse.json({ success: false, code: 'ALREADY_CLOSED', message: '이미 종료확인이 완료된 허가서입니다.' }, { status: 409 });
    }
    if (isSig(comp.workerSignature)) {
      return NextResponse.json({ success: false, code: 'ALREADY_REPORTED', message: '이미 종료신고가 접수되었습니다. 안전환경 확인을 기다려 주세요.' }, { status: 409 });
    }

    const now = new Date().toISOString();
    // complete_report 와 동일 필드(workerSignature/completedAt/restoreState/reportBy/reportAt)
    const nextComp = {
      ...comp,
      workerSignature: signature,
      completedAt: now,
      restoreState: restoreState || (comp.restoreState ?? ''),
      reportBy: name,   // 업체 신고자(소장) 성명 — 관리자 대리는 이메일, 여기선 이름
      reportAt: now,
    };
    const { data: upd, error: upErr } = await supabase
      .from('work_permits').update({ completion: nextComp }).eq('id', permitId).select('id');
    if (upErr || !upd || upd.length === 0) {
      console.error('[complete-report] save:', upErr);
      return NextResponse.json({ success: false, code: 'SAVE_FAILED', message: '저장 실패' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data: { reported: true, permitNumber: permit.permit_number } });
  } catch (e) {
    console.error('[complete-report] fatal:', e);
    return NextResponse.json({ success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
