import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/equipment';

export const runtime = 'nodejs';

/**
 * POST /api/work-permits/:id/confirm-participant  (공개)
 * 참여자 본인이 "해당 허가서"에 직접 [확인] — 그 시점 서명 스탬프 + 확인 시각을
 * work_permits.tbm.confirmations 에 기록. (TBM 참석자 서명 자동 인쇄 원본)
 * - 본인 확인: 이름 + 정규화 연락처가 이 허가서의 참여자와 일치해야 함.
 * - 미확인 참여자는 출력물 TBM 서명칸 공란(스탬프 없음).
 */
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const permitId = ctx.params.id;
  try {
    const body = await req.json().catch(() => ({}));
    const name = (body.name ?? '').toString().trim();
    const phone = (body.phone ?? '').toString();
    const signature = body.signature;

    if (!name || phone.replace(/[^0-9]/g, '').length < 10) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '이름·연락처를 정확히 입력해 주세요.' },
        { status: 400 }
      );
    }
    if (typeof signature !== 'string' || !signature.startsWith('data:image/')) {
      return NextResponse.json(
        { success: false, code: 'NO_SIGNATURE', message: '서명을 입력해 주세요.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const { data: permit, error: pErr } = await supabase
      .from('work_permits')
      .select('id, tbm')
      .eq('id', permitId)
      .maybeSingle();
    if (pErr) {
      console.error('[confirm-participant] permit:', pErr);
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: '조회 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }
    if (!permit) {
      return NextResponse.json(
        { success: false, code: 'NOT_FOUND', message: '작업허가 신청을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    // 본인 = 이 허가서 참여자인지 확인 (이름 + 정규화 연락처)
    const { data: parts, error: partErr } = await supabase
      .from('work_permit_participants')
      .select('name, phone')
      .eq('work_permit_id', permitId);
    if (partErr) {
      console.error('[confirm-participant] participants:', partErr);
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: '참여자 조회 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }
    const norm = normalizePhone(phone);
    const isParticipant = (parts ?? []).some(
      (p: any) => (p.name ?? '').trim() === name && normalizePhone(p.phone) === norm
    );
    if (!isParticipant) {
      return NextResponse.json(
        { success: false, code: 'NOT_PARTICIPANT', message: '이 작업허가의 참여자 명단에서 본인을 찾을 수 없습니다.' },
        { status: 403 }
      );
    }

    // tbm.confirmations[name||normPhone] = { name, signature, confirmedAt }
    const tbm = (permit.tbm ?? {}) as Record<string, any>;
    const confirmations = { ...(tbm.confirmations ?? {}) };
    confirmations[`${name}||${norm}`] = {
      name,
      signature,
      confirmedAt: new Date().toISOString(),
    };
    const nextTbm = { ...tbm, confirmations };

    const { error: upErr } = await supabase
      .from('work_permits')
      .update({ tbm: nextTbm })
      .eq('id', permitId);
    if (upErr) {
      console.error('[confirm-participant] update:', upErr);
      return NextResponse.json(
        { success: false, code: 'SAVE_FAILED', message: '확인 저장에 실패했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: { confirmedAt: confirmations[`${name}||${norm}`].confirmedAt } });
  } catch (e) {
    console.error('[confirm-participant] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
