import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * POST /api/sessions
 * 기본정보 입력 후 교육 세션 생성.
 * 주의: 호출 전 /api/lookup 으로 기존 유효 수료 먼저 확인할 것.
 *
 * 1A 변경:
 * - companyId(선택)를 받아 companies 에서 업체명을 조회하여 affiliation 스냅샷으로 함께 저장.
 * - companyId 가 없으면 기존처럼 affiliation 자유입력만 사용 (구버전 호환).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      affiliation,
      companyId,
      name,
      birthDate,
      phone,
      targetTypeCode,
      vehicleNumber,
      consentYn,
    } = body;

    const trimmedAffiliation =
      typeof affiliation === 'string' ? affiliation.trim() : '';
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const normalizedCompanyId =
      typeof companyId === 'string' && companyId.trim() ? companyId.trim() : null;

    if (
      (!trimmedAffiliation && !normalizedCompanyId) ||
      !trimmedName ||
      !birthDate ||
      !phone ||
      !targetTypeCode
    ) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '필수 정보가 누락되었습니다.' },
        { status: 400 }
      );
    }

    if (!consentYn) {
      return NextResponse.json(
        { success: false, code: 'CONSENT_REQUIRED', message: '개인정보 수집에 동의해야 합니다.' },
        { status: 400 }
      );
    }

    const vehicleRequired = targetTypeCode === 'TRUCK' || targetTypeCode === 'HEAVY';
    const vehicleNumberTrimmed =
      typeof vehicleNumber === 'string' ? vehicleNumber.trim() : '';

    if (vehicleRequired && !vehicleNumberTrimmed) {
      return NextResponse.json(
        { success: false, code: 'VEHICLE_NUMBER_REQUIRED', message: '차량번호를 입력해 주세요.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // 0. company_id 가 있으면 업체 조회 → 업체명을 affiliation 스냅샷으로 채움
    let resolvedAffiliation = trimmedAffiliation;
    let resolvedCompanyId: string | null = null;

    if (normalizedCompanyId) {
      const { data: company, error: companyErr } = await supabase
        .from('companies')
        .select('id, name, status')
        .eq('id', normalizedCompanyId)
        .maybeSingle();

      if (companyErr) {
        console.error('[api/sessions] company lookup error:', companyErr);
        return NextResponse.json(
          { success: false, code: 'COMPANY_LOOKUP_FAILED', message: '업체 정보를 확인할 수 없습니다.' },
          { status: 500 }
        );
      }
      if (!company) {
        return NextResponse.json(
          { success: false, code: 'COMPANY_NOT_FOUND', message: '선택한 업체를 찾을 수 없습니다.' },
          { status: 400 }
        );
      }
      if (company.status === 'DISABLED') {
        return NextResponse.json(
          { success: false, code: 'COMPANY_DISABLED', message: '사용이 중지된 업체입니다.' },
          { status: 400 }
        );
      }
      resolvedCompanyId = company.id;
      // 업체명을 스냅샷으로 강제 — 업체명 변경 시에도 신청 시점 라벨 보존
      resolvedAffiliation = company.name;
    }

    // 대상 유형 조회
    const { data: targetType } = await supabase
      .from('target_types')
      .select('id')
      .eq('code', targetTypeCode)
      .single();

    if (!targetType) {
      return NextResponse.json(
        { success: false, code: 'INVALID_TARGET_TYPE', message: '대상 구분이 올바르지 않습니다.' },
        { status: 400 }
      );
    }

    // 대상별 활성 과정 조회
    const { data: course } = await supabase
      .from('courses')
      .select('id, version')
      .eq('target_type_id', targetType.id)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (!course) {
      return NextResponse.json(
        { success: false, code: 'NO_ACTIVE_COURSE', message: '활성화된 교육 과정이 없습니다.' },
        { status: 400 }
      );
    }

    // 세션 생성 — affiliation + company_id 동시 저장 (affiliation 은 스냅샷)
    const { data: session, error } = await supabase
      .from('training_sessions')
      .insert({
        affiliation: resolvedAffiliation,
        company_id: resolvedCompanyId,
        name: trimmedName,
        birth_date: birthDate,
        phone,
        vehicle_number: vehicleRequired ? vehicleNumberTrimmed : null,
        target_type_id: targetType.id,
        course_id: course.id,
        consent_yn: true,
        status: 'IN_PROGRESS',
      })
      .select()
      .single();

    if (error || !session) {
      console.error(error);
      return NextResponse.json(
        { success: false, code: 'SAVE_FAILED', message: '세션 생성에 실패했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        sessionId: session.id,
        courseId: course.id,
        status: 'IN_PROGRESS',
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
