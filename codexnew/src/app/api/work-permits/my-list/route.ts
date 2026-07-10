import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { stageFromLightRow } from '@/lib/work-permit-stage';

/**
 * POST /api/work-permits/my-list  (공개) — 신청자 본인 신청내역 조회 (월 단위)
 * req: { name, birthDate, phone, month:'YYYY-MM' }
 * res: { success, data:{ items:[...], month, minMonth, maxMonth } }
 *
 * - 본인(applicant_name + birth_date + phone) 일치 건만 반환. 타인 명단 덤프 없음.
 * - 조회 월과 작업기간(work_start~work_end)이 겹치는 건(월 경계 걸침 포함).
 * - 🔴 조회 범위 = 6개월 전 ~ 다음 달. 범위 밖 요청은 서버에서 클램프(프론트 우회 방지).
 * - 인쇄/양식은 permitId(UUID)로 접근(기존 모델과 동일).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = (typeof body.name === 'string' ? body.name : '').trim();
    const birthDate = (typeof body.birthDate === 'string' ? body.birthDate : '').trim();
    const phone = (typeof body.phone === 'string' ? body.phone : '').replace(/[^0-9]/g, '');
    const monthRaw = (typeof body.month === 'string' ? body.month : '').trim();

    if (!name || !birthDate || phone.length < 10) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '이름·생년월일·연락처를 정확히 입력해 주세요.' },
        { status: 400 }
      );
    }

    // 허용 조회 범위(KST): 6개월 전 ~ 다음 달. 잘못된/범위 밖 month 는 클램프.
    const pad = (n: number) => String(n).padStart(2, '0');
    const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const ym = (offset: number) => {
      const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + offset, 1));
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
    };
    const thisMonth = ym(0), minMonth = ym(-6), maxMonth = ym(1);
    let month = /^\d{4}-\d{2}$/.test(monthRaw) ? monthRaw : thisMonth;
    if (month < minMonth) month = minMonth;
    if (month > maxMonth) month = maxMonth;

    // 월 겹침 조건: work_start ≤ 월말 AND work_end ≥ 월초 (관리자 목록과 동일 패턴)
    const [y, m] = month.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const monthStart = `${month}-01T00:00:00+09:00`;
    const monthEnd = `${month}-${pad(lastDay)}T23:59:59+09:00`;

    const supabase = createServiceClient();
    const { data: permits, error } = await supabase
      .from('work_permits')
      .select(
        `id, permit_number, work_name, work_start, work_end, request_company_name, supplemental,
         status, created_at, issuer_signature, started_at,
         work_location, equipment_no, work_content, applicant_title, request_company_id, tbm`
      )
      .eq('applicant_name', name)
      .eq('applicant_birth_date', birthDate)
      .eq('applicant_phone', phone)
      .lte('work_start', monthEnd)
      .gte('work_end', monthStart)
      .order('work_start', { ascending: false })
      .limit(200);

    if (error) {
      console.error('[work-permits/my-list] error:', error);
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: '조회 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }

    const nowMs = Date.now(); // 미종료/기간 경과 판정 기준
    const items = (permits ?? []).map((p: any) => ({
      permitId: p.id,
      permitNumber: p.permit_number,
      workName: p.work_name,
      workStart: p.work_start,
      workEnd: p.work_end,
      companyName: p.request_company_name,
      supplemental: p.supplemental ?? {},
      status: p.status,
      stage: stageFromLightRow(p, nowMs), // R-6 진행단계(목록 경량뱃지, 미종료 판정 포함)
      createdAt: p.created_at,
      issued: !!(p.issuer_signature && String(p.issuer_signature).startsWith('data:image/')), // 1차 승인 여부
      // 복사 재신청용 원본 내용(본인확인 통과자 본인 것만). 날짜·서명·참여자·TBM 확인은 제외.
      copy: {
        companyId: p.request_company_id ?? null,
        companyName: p.request_company_name ?? null,
        workName: p.work_name ?? '',
        workLocation: p.work_location ?? '',
        equipmentNo: p.equipment_no ?? '',
        applicantTitle: p.applicant_title ?? '',
        workContent: p.work_content ?? '',
        supplemental: p.supplemental ?? {},
        riskFactors: Array.isArray((p.tbm ?? {}).riskFactors) ? (p.tbm as any).riskFactors : [],
        safetyMeasures: Array.isArray((p.tbm ?? {}).safetyMeasures) ? (p.tbm as any).safetyMeasures : [],
      },
    }));

    return NextResponse.json({ success: true, data: { items, month, minMonth, maxMonth } });
  } catch (e) {
    console.error('[work-permits/my-list] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
