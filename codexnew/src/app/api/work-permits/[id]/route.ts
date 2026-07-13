import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getDocsForOutput } from '@/lib/safety-doc-status';
import { stageFromRow } from '@/lib/work-permit-stage';
import { resolveSignerLabels } from '@/lib/work-permit-signer';
import { normalizePhone } from '@/lib/equipment';
import QRCode from 'qrcode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // ⚠️ 캐시 금지 — 재서명/종료확인 즉시 반영
export const fetchCache = 'force-no-store';

/**
 * GET /api/work-permits/:id  (공개, UUID 알아야) — 인쇄/양식용 데이터
 * - 안전조치 없음(현장 빈칸). 1C-2 필수문서(docs) 포함.
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const supabase = createServiceClient();

  const { data: permit, error } = await supabase
    .from('work_permits')
    .select(
      `id, permit_number, permit_type, status, request_company_id, request_company_name,
       work_name, work_location, work_start, work_end, work_content,
       applicant_name, applicant_phone, applicant_title, equipment_no,
       tbm, supplemental, equipment, note, created_at,
       applicant_signature, issuer_title, issuer_signature, approved_by, approved_at,
       approver_name, approver_title, approver_signature, approval_mode, approver_signed_at,
       completion, dept_confirmations, started_by, started_at, rollback_logs`
    )
    .eq('id', ctx.params.id)
    .maybeSingle();

  if (error) {
    console.error('[work-permits/:id] error:', error);
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

  const { data: parts, error: partErr } = await supabase
    .from('work_permit_participants')
    .select(
      'name, phone, company_name, target_type, vehicle_number, equipment_type, spec, completed_at, expires_at, sort_order'
    )
    .eq('work_permit_id', ctx.params.id)
    .order('sort_order', { ascending: true });

  if (partErr) {
    console.error('[work-permits/:id] participants:', partErr);
    return NextResponse.json(
      { success: false, code: 'QUERY_FAILED', message: '참여자 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }

  // R-6 ③-4: 서명자 이메일 → "부서 이름 직책" 라벨 맵(표시용). 저장값은 이메일 그대로.
  const tbmObj = (permit.tbm ?? {}) as Record<string, any>;
  const compObj = (permit.completion ?? {}) as Record<string, any>;
  const deptObj = (permit.dept_confirmations ?? {}) as Record<string, any>;
  const rollbackLogsRaw: any[] = Array.isArray(permit.rollback_logs) ? permit.rollback_logs : [];
  const signerEmails = [
    permit.approved_by,
    permit.started_by,
    tbmObj.witness?.by,
    compObj.reportBy,
    compObj.confirmBy,
    ...Object.values(deptObj).map((v: any) => v?.by),
    ...rollbackLogsRaw.map((l: any) => l?.by),
  ];
  const signerLabelMap = await resolveSignerLabels(supabase, signerEmails);
  // 표시명 변환기(공개 응답에 이메일 원문 노출 금지 — 등록명 or 이메일 앞부분)
  const lab = (email?: string | null): string | null => {
    if (!email) return null;
    const v = String(email);
    // 이메일이 아니면(업체 종료신고자 성명 등) 그대로 표시. 미등록 관리자 이메일이면 null.
    if (!v.includes('@')) return v;
    return signerLabelMap.get(v.toLowerCase()) || null;
  };

  // ⚠️ 공개 응답 정화(3차 감사 발견1): tbm.confirmations 키의 전화번호 제거 + 서명자 이메일→표시명.
  //  (관리자 상세는 Object.values(confirmations)의 name/서명만 쓰므로 키 재작성 안전)
  const safeConfirmations: Record<string, any> = {};
  let _ci = 0;
  for (const c of Object.values(tbmObj.confirmations ?? {}) as any[]) {
    safeConfirmations[`c${_ci++}`] = { name: c?.name ?? null, signature: c?.signature ?? null, confirmedAt: c?.confirmedAt ?? null };
  }
  const safeTbm = {
    ...tbmObj,
    confirmations: safeConfirmations,
    witness: tbmObj.witness
      ? { signature: tbmObj.witness.signature ?? null, at: tbmObj.witness.at ?? null, by: lab(tbmObj.witness.by) }
      : undefined,
  };
  const safeCompletion = { ...compObj, reportBy: lab(compObj.reportBy), confirmBy: lab(compObj.confirmBy) };
  const safeDept: Record<string, any> = {};
  for (const [k, v] of Object.entries(deptObj)) {
    const vv = v as any;
    safeDept[k] = { ...vv, by: lab(vv.by), name: vv.name || lab(vv.by) };
  }

  // QR(허가번호+검증 URL) — print 화면 헤더용
  let qrDataUrl: string | null = null;
  try {
    // QR = 완전한 인쇄 페이지 주소(스캔 즉시 브라우저로 열림). env 없으면 운영 도메인 하드 폴백.
    const base = (process.env.NEXT_PUBLIC_SITE_URL || 'https://safety-edu.vercel.app').replace(/\/$/, '');
    const verifyUrl = `${base}/work-permit/print/${permit.id}`;
    qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 200 });
  } catch (e) {
    console.error('[work-permits/:id] qr:', e);
  }

  // TBM 현장 사진 signed URL(비공개 버킷 → 10분 임시) — print 화면 표시용
  const tbmPhotoUrls: string[] = [];
  for (const p of Array.isArray(tbmObj.photos) ? tbmObj.photos : []) {
    try {
      const { data: signed } = await supabase.storage.from('work-permit-photos').createSignedUrl(p, 600);
      if (signed?.signedUrl) tbmPhotoUrls.push(signed.signedUrl);
    } catch { /* */ }
  }

  // 1C-2 필수문서 데이터(인쇄 첨부용)
  let docs = null;
  try {
    docs = await getDocsForOutput(supabase, {
      companyId: permit.request_company_id ?? null,
      workStart: permit.work_start,
      participants: (parts ?? []).map((p: any) => ({
        name: p.name, phone: p.phone ?? null, companyName: p.company_name,
      })),
    });
  } catch (e) {
    console.error('[work-permits/:id] docs:', e);
  }

  return NextResponse.json({
    success: true,
    data: {
      permitId: permit.id,
      permitNumber: permit.permit_number,
      permitType: permit.permit_type,
      status: permit.status,
      stage: stageFromRow(permit, Date.now()), // R-6 진행단계(뱃지, 미종료 판정 포함)
      companyName: permit.request_company_name,
      info: {
        workName: permit.work_name,
        workLocation: permit.work_location,
        workStart: permit.work_start,
        workEnd: permit.work_end,
        workContent: permit.work_content,
        applicantName: permit.applicant_name,
        applicantTitle: permit.applicant_title,
        equipmentNo: permit.equipment_no,
      },
      supplemental: permit.supplemental ?? {},
      equipment: Array.isArray(permit.equipment) ? permit.equipment : [],
      tbm: safeTbm, // 정화됨(전화번호·이메일 제거)
      // R-6: 신청인 서명 / 발급자(안전환경) / 승인자(요청부서 현장책임자) / 작업완료
      applicantSignature: permit.applicant_signature ?? null,
      issuer: {
        name: lab(permit.approved_by), // 이메일 대신 표시명
        title: permit.issuer_title ?? null,
        signature: permit.issuer_signature ?? null,
        at: permit.approved_at ?? null,
      },
      approval: {
        name: permit.approver_name ?? null, // 이메일 아님(수기 성명)
        title: permit.approver_title ?? null,
        signature: permit.approver_signature ?? null,
        mode: permit.approval_mode ?? null,
        at: permit.approver_signed_at ?? null,
      },
      completion: safeCompletion,
      deptConfirmations: safeDept,
      startedBy: lab(permit.started_by),
      startedAt: permit.started_at ?? null,
      // 되돌리기 이력(표시용) — 서명자 이메일은 표시명으로 변환(공개 응답에 이메일 노출 금지)
      rollbackLogs: rollbackLogsRaw.map((l: any) => ({
        stage: l?.stage ?? null,
        label: l?.label ?? null,
        supKey: l?.supKey ?? null,
        by: lab(l?.by),
        at: l?.at ?? null,
        reason: l?.reason ?? null,
      })),
      qrDataUrl,
      tbmPhotoUrls,
      // ⑥ 동명이인 방지: TBM 서명을 저장 키(이름||정규화전화)로 참여자별 매칭해 첨부(이름 단독 매칭 금지).
      participants: (parts ?? []).map((p: any) => {
        const key = `${(p.name ?? '').trim()}||${normalizePhone(p.phone)}`;
        const conf = (tbmObj.confirmations ?? {})[key];
        return {
          name: p.name,
          companyName: p.company_name,
          targetType: p.target_type,
          vehicleNumber: p.vehicle_number,
          equipmentType: p.equipment_type,
          spec: p.spec,
          completedAt: p.completed_at,
          expiresAt: p.expires_at,
          tbmSignature: conf?.signature ?? null,
          tbmConfirmedAt: conf?.confirmedAt ?? null,
        };
      }),
      note: permit.note,
      createdAt: permit.created_at,
      docs,
    },
  });
}
