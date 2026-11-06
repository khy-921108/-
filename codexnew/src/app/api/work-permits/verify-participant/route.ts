import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { evaluateParticipant } from '@/lib/participant-eligibility';
import { maskPhone } from '@/lib/format';
import { personIdOf, resolvePersonInput } from '@/lib/person-ref';

/**
 * POST /api/work-permits/verify-participant  (공개) — 1명씩 본인확인
 * req: { name, birthDate, phone, workEnd } 또는 { ref, workEnd }  (작업 종료일시 — 작업일 기준 판정)
 * res: { success, data:{ status:'VALID'|'EXPIRED'|'NONE', name, companyName, targetLabel,
 *                        vehicleNumber?, spec?, equipmentType?, completedAt, expiresAt,
 *                        marginDays, phoneMasked, personId } }
 *
 * - VALID: expires_at >= workEnd (작업일까지 유효)
 * - EXPIRED: 작업일에 만료 → 추가불가
 * - NONE: 수료 없음
 * - 업체 전체 명단 반환 없음(1명 조회). 연락처 마스킹.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const resolved = resolvePersonInput(body);
    if (!resolved.ok) {
      return NextResponse.json(
        { success: false, code: resolved.code, message: resolved.message },
        { status: 400 }
      );
    }
    const { name, birthDate, phone } = resolved.person;
    const workEnd = typeof body.workEnd === 'string' ? body.workEnd : '';

    if (!name || !birthDate || !phone) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '이름·생년월일·연락처를 입력해 주세요.' },
        { status: 400 }
      );
    }
    if (!workEnd || isNaN(new Date(workEnd).getTime())) {
      return NextResponse.json(
        { success: false, code: 'NO_WORK_END', message: '작업 종료일시가 필요합니다. 작업정보를 먼저 입력해 주세요.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const result = await evaluateParticipant(supabase, { name, birthDate, phone }, workEnd);

    // 응답에서 PII 마스킹 + 필드 선별 (원본 phone/sessionId 등은 미노출)
    return NextResponse.json({
      success: true,
      data: {
        status: result.status,
        name: result.name,
        companyName: result.companyName,
        targetCode: result.targetCode, // 장비 대조용(HEAVY 등)
        targetLabel: result.targetLabel,
        vehicleNumber: result.vehicleNumber,
        spec: result.spec,
        equipmentType: result.equipmentType,
        completedAt: result.completedAt,
        expiresAt: result.expiresAt,
        marginDays: result.marginDays,
        phoneMasked: maskPhone(phone),
        personId: personIdOf({ name, birthDate, phone }),
      },
    });
  } catch (e) {
    console.error('[verify-participant] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
