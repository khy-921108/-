import QRCode from 'qrcode';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fillWorkPermitWorkbook, type PermitDocData } from './work-permit-template';
import { resolveSignerLabels, labelFor } from './work-permit-signer';
import { normalizePhone } from './equipment';
import { getDocsForOutput } from './safety-doc-status';

/**
 * 작업허가서 1건 → 회사양식 xlsx Buffer 생성. (공개 GET 라우트 + 월별 백업 공용)
 * 없는 허가서면 null. 출력 로직은 fillWorkPermitWorkbook 로 동일.
 */
export async function generateWorkPermitXlsx(
  supabase: SupabaseClient,
  permitId: string
): Promise<{ buffer: Buffer; permitNumber: string } | null> {
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
    .eq('id', permitId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!permit) return null;

  const { data: parts } = await supabase
    .from('work_permit_participants')
    .select('name, phone, company_name, sort_order')
    .eq('work_permit_id', permitId)
    .order('sort_order', { ascending: true });

  const participantList = (parts ?? []).map((p: any) => ({
    name: p.name,
    phone: p.phone ?? null,
    companyName: p.company_name,
  }));

  // [R-6] 소장(신청인)도 참여자 전원 포함(이름+전화 중복이면 제외).
  const pkey = (n?: string | null, ph?: string | null) =>
    `${(n ?? '').trim()}|${String(ph ?? '').replace(/\D/g, '')}`;
  const applicantName = (permit.applicant_name ?? '').trim();
  const applicantInList = participantList.some(
    (p) => pkey(p.name, p.phone) === pkey(applicantName, permit.applicant_phone)
  );
  const allParticipants =
    applicantName && !applicantInList
      ? [{ name: applicantName, phone: permit.applicant_phone ?? null, companyName: permit.request_company_name }, ...participantList]
      : participantList;

  let docs;
  try {
    docs = await getDocsForOutput(supabase, {
      companyId: permit.request_company_id ?? null,
      workStart: permit.work_start,
      participants: allParticipants,
    });
  } catch (e) {
    console.error('[work-permit-xlsx] docs:', e);
    docs = undefined;
  }

  const tbm = (permit.tbm ?? {}) as Record<string, any>;
  const tbmPhotos: string[] = [];
  for (const p of Array.isArray(tbm.photos) ? tbm.photos : []) {
    try {
      const { data: blob, error: dlErr } = await supabase.storage.from('work-permit-photos').download(p);
      if (dlErr || !blob) continue;
      const b64 = Buffer.from(await blob.arrayBuffer()).toString('base64');
      tbmPhotos.push(`data:image/jpeg;base64,${b64}`);
    } catch (e) {
      console.error('[work-permit-xlsx] photo:', e);
    }
  }
  let qrDataUrl: string | null = null;
  try {
    const base = (process.env.NEXT_PUBLIC_SITE_URL || 'https://safety-edu.vercel.app').replace(/\/$/, '');
    qrDataUrl = await QRCode.toDataURL(`${base}/work-permit/print/${permit.id}`, { margin: 1, width: 220 });
  } catch (e) {
    console.error('[work-permit-xlsx] qr:', e);
  }

  const comp0 = (permit.completion ?? {}) as Record<string, any>;
  const dept0 = (permit.dept_confirmations ?? {}) as Record<string, any>;
  const smap = await resolveSignerLabels(supabase, [
    permit.approved_by, tbm.witness?.by, comp0.confirmBy, comp0.reportBy,
    ...Object.values(dept0).map((v: any) => v?.by),
  ]);
  const safeLabel = (v: any): string | null => {
    if (!v) return null;
    const s = String(v);
    if (!s.includes('@')) return s;
    return labelFor(smap, s) || null;
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
    participants: allParticipants.map((p: any) => {
      const conf = (tbm.confirmations ?? {})[`${(p.name ?? '').trim()}||${normalizePhone(p.phone)}`];
      return { name: p.name, companyName: p.companyName, tbmSignature: conf?.signature ?? null, tbmConfirmedAt: conf?.confirmedAt ?? null };
    }),
    note: permit.note,
    createdAt: permit.created_at,
    docs,
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
    witness: tbm.witness
      ? { name: safeLabel(tbm.witness.by), signature: tbm.witness.signature ?? null, at: tbm.witness.at ?? null }
      : null,
    safetyInstructions: typeof tbm.safetyInstructions === 'string' ? tbm.safetyInstructions : null,
    deptConfirmations: deptOut as PermitDocData['deptConfirmations'],
    tbmExtra: {
      workContent: tbm.workContent ?? null,
      riskFactors: Array.isArray(tbm.riskFactors) ? tbm.riskFactors : [],
      safetyMeasures: Array.isArray(tbm.safetyMeasures) ? tbm.safetyMeasures : [],
      teamLeaderSignature: tbm.teamLeader?.signature ?? null,
      safetyManager: tbm.safetyManager
        ? { name: tbm.safetyManager.name ?? null, signature: tbm.safetyManager.signature ?? null, company: tbm.safetyManager.company ?? null }
        : null,
      confirmations: tbm.confirmations ?? {},
    },
    tbmPhotos,
    qrDataUrl,
  };

  const buffer = await fillWorkPermitWorkbook(docData);
  return { buffer, permitNumber: permit.permit_number };
}
