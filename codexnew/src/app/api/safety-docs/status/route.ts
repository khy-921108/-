import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { evaluateRequiredDocs, type DocPerson } from '@/lib/safety-doc-status';
import { maskPhone } from '@/lib/format';
import { resolvePersonInputs } from '@/lib/person-ref';

/**
 * POST /api/safety-docs/status  (공개) — 필수문서 유효성 확인
 * (참여자 목록 전달 필요 → GET 대신 POST. 요청받은 참여자·업체 범위만 반환)
 * req: { companyId, workEnd, participants:[{name,birthDate,phone} 또는 {ref}] }
 * res: { success, data:{ pledges:[{name, status, expiresAt, saved}], undertaking:{...}, allValid } }
 * - pledges 순서는 입력 순서 그대로(화면이 순서로 대조).
 * - ref 로 온 사람은 서약 상태와 상관없이 saved 를 비운다. 신청인이 그 사람의 국적·혈액형·직종을 보면 안 된다.
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

    const resolved = resolvePersonInputs(participantsIn);
    if (!resolved.ok) {
      return NextResponse.json(
        { success: false, code: resolved.code, message: resolved.message },
        { status: 400 }
      );
    }
    const participants: DocPerson[] = resolved.persons;

    const supabase = createServiceClient();
    const result = await evaluateRequiredDocs(supabase, { companyId, participants, workEnd });

    // 응답: 마스킹 + 필드 선별
    return NextResponse.json({
      success: true,
      data: {
        allValid: result.allValid,
        pledges: result.pledges.map((pl, i) => ({
          name: pl.name,
          status: pl.status,
          expiresAt: pl.expiresAt,
          // 국적·혈액형·직종(직접 입력한 사람의 재사용 프리필용)
          saved: resolved.fromRef[i] ? null : pl.saved,
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
