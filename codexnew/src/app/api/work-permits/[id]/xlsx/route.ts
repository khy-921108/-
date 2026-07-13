import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { createServiceClient } from '@/lib/supabase/server';
import { fillWorkPermitWorkbook, type PermitDocData } from '@/lib/work-permit-template';
import { resolveSignerLabels, labelFor } from '@/lib/work-permit-signer';
import { normalizePhone } from '@/lib/equipment';
import { getDocsForOutput } from '@/lib/safety-doc-status';

export const runtime = 'nodejs'; // exceljs + 템플릿 파일 읽기 + qrcode
export const dynamic = 'force-dynamic'; // ⚠️ 캐시 금지 — 없으면 옛 서명/종료확인 누락된 xlsx가 캐시됨
export const fetchCache = 'force-no-store'; // Supabase 조회를 항상 최신으로

/**
 * GET /api/work-permits/:id/xlsx  (공개, UUID 알아야) — 회사 양식 자동채움 다운로드
 * - work-permit-template.ts 로 템플릿 로드→셀 채움→attachment.
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const supabase = createServiceClient();

  const { data: permit, error } = await supabase
    .from('work_permits')
    .select(
      `id, permit_number, request_company_id, request_company_name, work_name, work_location,
       work_start, work_end, work_content, applicant_name, applicant_title, applicant_phone,
       equipment_no, supplemental, equipment, note, created_at, tbm,
       applicant_signature, issuer_title, issuer_signature, approved_by, approved_at,
       approver_name, approver_title, approver_signature, approval_mode, approver_signed_at,
       completion, dept_confirmations`
    )
    .eq('id', ctx.params.id)
    .maybeSingle();

  if (error) {
    console.error('[work-permits/:id/xlsx] error:', error);
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

  const { data: parts } = await supabase
    .from('work_permit_participants')
    .select('name, phone, company_name, sort_order')
    .eq('work_permit_id', ctx.params.id)
    .order('sort_order', { ascending: true });

  const participantList = (parts ?? []).map((p: any) => ({
    name: p.name,
    phone: p.phone ?? null,
    companyName: p.company_name,
  }));

  // [R-6] 소장(신청인)도 예외 없이 참여자 전원 포함 (조율 세션 확정 2026-07-08).
  //  "작업 나온 사람은 소장 포함 전원 참여자 → 서약·교육·TBM 명단에 자동 포함".
  //  신청인을 명단 맨 앞에 합침(이름+전화 중복이면 제외). 소장은 사전에 교육·서약을 거친 상태여야
  //  서약/교육 서명이 조회됨(작업자와 동일 경로). 소장은 신청인·현장소장 서명에도 추가 등장(정상).
  const pkey = (n?: string | null, ph?: string | null) =>
    `${(n ?? '').trim()}|${String(ph ?? '').replace(/\D/g, '')}`;
  const applicantName = (permit.applicant_name ?? '').trim();
  const applicantInList = participantList.some(
    (p) => pkey(p.name, p.phone) === pkey(applicantName, permit.applicant_phone)
  );
  const allParticipants =
    applicantName && !applicantInList
      ? [
          { name: applicantName, phone: permit.applicant_phone ?? null, companyName: permit.request_company_name },
          ...participantList,
        ]
      : participantList;

  // 1C-2 필수문서 데이터 수집(있으면 출력에 첨부)
  let docs;
  try {
    docs = await getDocsForOutput(supabase, {
      companyId: permit.request_company_id ?? null,
      workStart: permit.work_start,
      participants: allParticipants,
    });
  } catch (e) {
    console.error('[work-permits/:id/xlsx] docs fetch:', e);
    docs = undefined; // 문서 수집 실패해도 1C-1 양식은 출력
  }

  // R-6: TBM 상세 + 현장 사진(Storage 다운로드 → base64) + QR 생성
  const tbm = (permit.tbm ?? {}) as Record<string, any>;
  const tbmPhotos: string[] = [];
  for (const p of Array.isArray(tbm.photos) ? tbm.photos : []) {
    try {
      const { data: blob, error: dlErr } = await supabase.storage.from('work-permit-photos').download(p);
      if (dlErr || !blob) continue;
      const b64 = Buffer.from(await blob.arrayBuffer()).toString('base64');
      tbmPhotos.push(`data:image/jpeg;base64,${b64}`);
    } catch (e) {
      console.error('[work-permits/:id/xlsx] photo download:', e);
    }
  }
  let qrDataUrl: string | null = null;
  try {
    // QR = 완전한 인쇄 페이지 주소(스캔 즉시 브라우저로 열림). env 없으면 운영 도메인 하드 폴백.
    const base = (process.env.NEXT_PUBLIC_SITE_URL || 'https://safety-edu.vercel.app').replace(/\/$/, '');
    const verifyUrl = `${base}/work-permit/print/${permit.id}`;
    qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 220 });
  } catch (e) {
    console.error('[work-permits/:id/xlsx] qr:', e);
  }

  // R-6 ③-4: 서명자 이메일 → "부서 이름 직책" 라벨(출력 표기용)
  const comp0 = (permit.completion ?? {}) as Record<string, any>;
  const dept0 = (permit.dept_confirmations ?? {}) as Record<string, any>;
  const smap = await resolveSignerLabels(supabase, [
    permit.approved_by, tbm.witness?.by, comp0.confirmBy, comp0.reportBy,
    ...Object.values(dept0).map((v: any) => v?.by),
  ]);
  // 완료/별지 확인자 표기를 라벨로 치환(출력 사본 — DB 무변경).
  //  ⑤: 미등록 관리자 이메일 fallback 노출 제거 — 이메일이면 라벨 or null, 이름이면 그대로(업체 종료신고자 등).
  const safeLabel = (v: any): string | null => {
    if (!v) return null;
    const s = String(v);
    if (!s.includes('@')) return s; // 이미 이름(관리자 이메일 아님)
    return labelFor(smap, s) || null; // 미등록 이메일 → null(공란)
  };
  const completionOut = { ...comp0, confirmBy: safeLabel(comp0.confirmBy), reportBy: safeLabel(comp0.reportBy) };
  const deptOut: Record<string, any> = {};
  for (const [k, v] of Object.entries(dept0)) {
    deptOut[k] = { ...(v as any), name: (v as any).name || safeLabel((v as any).by) };
  }

  const docData: PermitDocData = {
    permitNumber: permit.permit_number,
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
    // ⑥ 동명이인 방지: TBM 서명을 저장 키(이름||정규화전화)로 참여자별 매칭.
    participants: allParticipants.map((p: any) => {
      const conf = (tbm.confirmations ?? {})[`${(p.name ?? '').trim()}||${normalizePhone(p.phone)}`];
      return { name: p.name, companyName: p.companyName, tbmSignature: conf?.signature ?? null, tbmConfirmedAt: conf?.confirmedAt ?? null };
    }),
    note: permit.note,
    createdAt: permit.created_at,
    docs,
    // ===== R-6 =====
    applicantSignature: permit.applicant_signature ?? null,
    issuer: {
      name: safeLabel(permit.approved_by),
      title: permit.issuer_title ?? null,
      signature: permit.issuer_signature ?? null,
      at: permit.approved_at ?? null,
    },
    approval: {
      name: permit.approver_name ?? null,
      title: permit.approver_title ?? null,
      signature: permit.approver_signature ?? null,
      mode: permit.approval_mode ?? null,
      at: permit.approver_signed_at ?? null,
    },
    completion: completionOut as PermitDocData['completion'],
    // R-6 ③-2a: 입회자(2차)·안전지시사항 = tbm JSONB
    witness: tbm.witness
      ? { name: safeLabel(tbm.witness.by), signature: tbm.witness.signature ?? null, at: tbm.witness.at ?? null }
      : null,
    safetyInstructions: typeof tbm.safetyInstructions === 'string' ? tbm.safetyInstructions : null,
    // R-6 ③-2b: 3차 별지 현장확인
    deptConfirmations: deptOut as PermitDocData['deptConfirmations'],
    tbmExtra: {
      workContent: tbm.workContent ?? null,
      riskFactors: Array.isArray(tbm.riskFactors) ? tbm.riskFactors : [],
      safetyMeasures: Array.isArray(tbm.safetyMeasures) ? tbm.safetyMeasures : [],
      teamLeaderSignature: tbm.teamLeader?.signature ?? null,
      safetyManager: tbm.safetyManager
        ? {
            name: tbm.safetyManager.name ?? null,
            signature: tbm.safetyManager.signature ?? null,
            company: tbm.safetyManager.company ?? null,
          }
        : null,
      confirmations: tbm.confirmations ?? {},
    },
    tbmPhotos,
    qrDataUrl,
  };

  let buffer: Buffer;
  try {
    buffer = await fillWorkPermitWorkbook(docData);
  } catch (e) {
    console.error('[work-permits/:id/xlsx] fill error:', e);
    return NextResponse.json(
      { success: false, code: 'TEMPLATE_FAILED', message: '양식 생성에 실패했습니다.' },
      { status: 500 }
    );
  }

  const filename = `WP-${permit.permit_number}.xlsx`;
  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
