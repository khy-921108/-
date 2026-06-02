import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { evaluateParticipant } from '@/lib/participant-eligibility';
import { generateWorkPermitNumber } from '@/lib/work-permit-number';
import { SUPPLEMENTAL_KEYS } from '@/lib/work-permit-constants';
import { evaluateRequiredDocs } from '@/lib/safety-doc-status';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const companyId =
      typeof body.companyId === 'string' && body.companyId.trim() ? body.companyId.trim() : null;
    const info = body.info ?? {};
    const supplementalIn = body.supplemental ?? {};
    const participantsIn: any[] = Array.isArray(body.participants) ? body.participants : [];

    const workName = (info.workName ?? '').trim();
    const workLocation = (info.workLocation ?? '').trim();
    const workContent = (info.workContent ?? '').trim();
    const applicantName = (info.applicantName ?? '').trim();
    const applicantPhone = (info.applicantPhone ?? '').replace(/[^0-9]/g, '');
    const applicantTitle = (info.applicantTitle ?? '').trim() || null;
    const applicantBirthDate = (info.applicantBirthDate ?? '').trim() || null;
    const equipmentNo = (info.equipmentNo ?? '').trim() || null;
    const workStart = info.workStart;
    const workEnd = info.workEnd;

    if (!companyId || !workName || !workLocation || !workContent || !applicantName || !applicantPhone) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '필수 작업정보가 누락되었습니다.' },
        { status: 400 }
      );
    }
    const startTs = new Date(workStart).getTime();
    const endTs = new Date(workEnd).getTime();
    if (isNaN(startTs) || isNaN(endTs)) {
      return NextResponse.json(
        { success: false, code: 'INVALID_PERIOD', message: '작업일시 형식이 올바르지 않습니다.' },
        { status: 400 }
      );
    }
    if (startTs >= endTs) {
      return NextResponse.json(
        { success: false, code: 'INVALID_PERIOD', message: '작업 종료일시가 시작일시보다 빠를 수 없습니다.' },
        { status: 400 }
      );
    }
    if (participantsIn.length === 0) {
      return NextResponse.json(
        { success: false, code: 'NO_PARTICIPANT', message: '참여자를 최소 1명 추가해 주세요.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const { data: company, error: compErr } = await supabase
      .from('companies')
      .select('id, name, status')
      .eq('id', companyId)
      .maybeSingle();
    if (compErr) {
      console.error('[work-permits POST] company:', compErr);
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: '업체 확인 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }
    if (!company) {
      return NextResponse.json(
        { success: false, code: 'COMPANY_NOT_FOUND', message: '작업요청 업체를 찾을 수 없습니다.' },
        { status: 400 }
      );
    }
    if (company.status === 'DISABLED') {
      return NextResponse.json(
        { success: false, code: 'COMPANY_DISABLED', message: '사용이 중지된 업체입니다.' },
        { status: 400 }
      );
    }

    const evaluated = [];
    const invalid: { name: string; status: string }[] = [];
    for (const p of participantsIn) {
      const name = (p?.name ?? '').trim();
      const birthDate = (p?.birthDate ?? '').trim();
      const phone = (p?.phone ?? '').replace(/[^0-9]/g, '');
      if (!name || !birthDate || !phone) {
        invalid.push({ name: name || '(이름없음)', status: 'INVALID_INPUT' });
        continue;
      }
      const r = await evaluateParticipant(supabase, { name, birthDate, phone }, workEnd);
      if (r.status !== 'VALID') {
        invalid.push({ name, status: r.status });
      } else {
        evaluated.push(r);
      }
    }

    if (invalid.length > 0) {
      return NextResponse.json(
        {
          success: false,
          code: 'PARTICIPANT_NOT_ELIGIBLE',
          message: '교육이 작업일 기준 만료되었거나 수료 정보가 없는 참여자가 있습니다.',
          data: { invalid },
        },
        { status: 403 }
      );
    }

    // ---- 3.5 필수서류(1C-2) 서버 재검증 (작업종료일 기준) ----
    const docPersons = participantsIn.map((p: any) => ({
      name: (p?.name ?? '').trim(),
      birthDate: (p?.birthDate ?? '').trim(),
      phone: (p?.phone ?? '').toString(),
    }));
    let docs;
    try {
      docs = await evaluateRequiredDocs(supabase, { companyId, participants: docPersons, workEnd });
    } catch (e) {
      console.error('[work-permits POST] docs check:', e);
      return NextResponse.json(
        { success: false, code: 'DOC_QUERY_FAILED', message: '필수서류 확인 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }
    if (!docs.allValid) {
      return NextResponse.json(
        {
          success: false,
          code: 'DOCS_REQUIRED',
          message: '필수서류(개인서약/업체이행각서)가 미비합니다. "필수서류 확인" 단계에서 작성 후 제출해 주세요.',
          data: {
            missing: {
              pledges: docs.pledges.filter((p) => p.status !== 'VALID').map((p) => p.name),
              undertaking: docs.undertaking.status === 'VALID' ? null : docs.undertaking.status,
              undertakingMissingMembers: docs.undertaking.missingMembers,
            },
          },
        },
        { status: 403 }
      );
    }

    const supplemental: Record<string, 'Y' | 'N'> = {};
    for (const k of SUPPLEMENTAL_KEYS) {
      supplemental[k] = supplementalIn?.[k] === 'Y' ? 'Y' : 'N';
    }

    const tbm = {
      datetime: workStart,
      place: workLocation,
      workName,
      teamLeader: { company: company.name, name: applicantName },
      attendees: evaluated.map((e) => ({ name: e.name, company: e.companyName })),
    };

    let permit: any = null;
    let lastErr: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let permitNumber: string;
      try {
        permitNumber = await generateWorkPermitNumber(supabase);
      } catch (e) {
        lastErr = e;
        continue;
      }
      const { data, error } = await supabase
        .from('work_permits')
        .insert({
          permit_number: permitNumber,
          permit_type: 'GENERAL',
          request_company_id: company.id,
          request_company_name: company.name,
          work_name: workName,
          work_location: workLocation,
          work_start: new Date(workStart).toISOString(),
          work_end: new Date(workEnd).toISOString(),
          work_content: workContent,
          applicant_name: applicantName,
          applicant_phone: applicantPhone,
          applicant_title: applicantTitle,
          applicant_birth_date: applicantBirthDate,
          equipment_no: equipmentNo,
          tbm,
          supplemental,
          status: 'SUBMITTED',
        })
        .select('id, permit_number, status, created_at')
        .single();

      if (!error && data) {
        permit = data;
        break;
      }
      lastErr = error;
      if (error && (error as any).code !== '23505') break;
    }

    if (!permit) {
      console.error('[work-permits POST] insert failed:', lastErr);
      return NextResponse.json(
        { success: false, code: 'SAVE_FAILED', message: '작업허가 신청 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 500 }
      );
    }

    const participantRows = evaluated.map((e, i) => ({
      work_permit_id: permit.id,
      session_id: e.sessionId,
      name: e.name,
      phone: e.phone,
      company_id: e.companyId,
      company_name: e.companyName,
      target_type: e.targetCode,
      vehicle_number: e.vehicleNumber,
      equipment_type: e.equipmentType,
      spec: e.spec,
      completed_at: e.completedAt,
      expires_at: e.expiresAt,
      sort_order: i,
    }));

    const { error: partErr } = await supabase
      .from('work_permit_participants')
      .insert(participantRows);

    if (partErr) {
      console.error('[work-permits POST] participants insert failed, rolling back:', partErr);
      await supabase.from('work_permits').delete().eq('id', permit.id);
      return NextResponse.json(
        { success: false, code: 'SAVE_FAILED', message: '참여자 저장에 실패했습니다. 다시 시도해 주세요.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        permitId: permit.id,
        permitNumber: permit.permit_number,
        status: permit.status,
        createdAt: permit.created_at,
      },
    });
  } catch (e) {
    console.error('[work-permits POST] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
