import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { evaluateRequiredDocs, type DocPerson } from '@/lib/safety-doc-status';
import { maskPhone } from '@/lib/format';

/**
 * POST /api/safety-docs/status  (공개) — 필수문서 유효성 확인
 * (참여자 목록 전달 필요 → GET 대신 POST. 요청받은 참여자·업체 범위만 반환)
 * req: { companyId, workEnd, participants:[{name,birthDate,phone}] }
 * res: { success, data:{ pledges:[{name, status, expiresAt, saved}], undertaking:{...}, allValid } }
 * - 다른 업체/전체 문서/전체 명단 노출 금지. 이행각서 members 연락처는 마스킹.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const companyId =
      typeof body.companyId === 'string' && body.companyId.trim() ? body.companyId.trim() : '';
    const workEnd = typeof body.workEnd === 'string' ? body.workEnd : '';
    const participantsIn: any[] = Array.isArray(body.participants) ? body.participants : [];

    if (!companyId) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '업체 정보가 필요합니다.' },
        { status: 400 }
      );
    }
    if (!workEnd || isNaN(new Date(workEnd).getTime())) {
      return NextResponse.json(
        { success: false, code: 'NO_WORK_END', message: '작업 종료일시가 필요합니다.' },
        { status: 400 }
      );
    }

    const participants: DocPerson[] = participantsIn.map((p) => ({
      name: (p?.name ?? '').trim(),
      birthDate: (p?.birthDate ?? '').trim(),
      phone: (p?.phone ?? '').toString(),
    }));

    const supabase = createServiceClient();
    const result = await evaluateRequiredDocs(supabase, { companyId, participants, workEnd });

    // 응답: 마스킹 + 필드 선별
    return NextResponse.json({
      success: true,
      data: {
        allValid: result.allValid,
        pledges: result.pledges.map((pl) => ({
          name: pl.name,
          status: pl.status,
          expiresAt: pl.expiresAt,
          saved: pl.saved, // 국적·혈액형·직종(재사용 프리필용) — PII 아님
        })),
        undertaking: {
          status: result.undertaking.status,
          expiresAt: result.undertaking.expiresAt,
          workArea: result.undertaking.workArea,
          managerName: result.undertaking.managerName,
          managerPhone: maskPhone(result.undertaking.managerPhone ?? ''),
          memberCount: result.undertaking.members.length,
          missingMembers: result.undertaking.missingMembers,
        },
      },
    });
  } catch (e) {
    console.error('[safety-docs/status] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
