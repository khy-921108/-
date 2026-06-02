import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone } from './equipment';

/**
 * 1C-2 필수문서(개인서약·업체이행각서) 6개월 유효성 — 작업종료일 기준.
 */

export interface DocPerson {
  name: string;
  birthDate: string;
  phone: string;
}

export type PledgeStatus = 'VALID' | 'MISSING';
export type UndertakingStatus = 'VALID' | 'STALE_MEMBERS' | 'MISSING';

export interface PledgeResult {
  name: string;
  status: PledgeStatus;
  expiresAt: string | null;
  saved: { nationality: string | null; bloodType: string | null; jobType: string | null } | null;
}

export interface UndertakingResult {
  status: UndertakingStatus;
  expiresAt: string | null;
  workArea: string | null;
  managerName: string | null;
  managerPhone: string | null;
  members: { name: string; birthDate: string | null; phone: string | null }[];
  missingMembers: string[];
}

export interface RequiredDocsResult {
  allValid: boolean;
  pledges: PledgeResult[];
  undertaking: UndertakingResult;
}

function personKey(name: string, birthDate: string | null, normPhone: string | null): string {
  return `${(name ?? '').trim()}||${birthDate ?? ''}||${normPhone ?? ''}`;
}

export async function checkPledge(
  supabase: SupabaseClient,
  person: DocPerson,
  workEnd: string
): Promise<PledgeResult> {
  const name = (person.name ?? '').trim();
  const birthDate = (person.birthDate ?? '').trim();
  const normPhone = normalizePhone(person.phone);

  const base: PledgeResult = { name, status: 'MISSING', expiresAt: null, saved: null };
  if (!name || !birthDate || !normPhone) return base;

  const { data, error } = await supabase
    .from('safety_pledges')
    .select('nationality, blood_type, job_type, expires_at, issued_at')
    .eq('name', name)
    .eq('birth_date', birthDate)
    .eq('normalized_phone', normPhone)
    .order('issued_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('[safety-doc-status] pledge query:', error);
    throw new Error('DOC_QUERY_FAILED');
  }
  const latest = (data ?? [])[0];
  if (!latest) return base;

  const valid = new Date(latest.expires_at).getTime() >= new Date(workEnd).getTime();
  return {
    name,
    status: valid ? 'VALID' : 'MISSING',
    expiresAt: latest.expires_at,
    saved: {
      nationality: latest.nationality ?? null,
      bloodType: latest.blood_type ?? null,
      jobType: latest.job_type ?? null,
    },
  };
}

export async function checkUndertaking(
  supabase: SupabaseClient,
  companyId: string,
  participants: DocPerson[],
  workEnd: string
): Promise<UndertakingResult> {
  const empty: UndertakingResult = {
    status: 'MISSING',
    expiresAt: null,
    workArea: null,
    managerName: null,
    managerPhone: null,
    members: [],
    missingMembers: [],
  };
  if (!companyId) return empty;

  const { data, error } = await supabase
    .from('company_undertakings')
    .select('work_area, manager_name, manager_phone, members, expires_at, issued_at')
    .eq('company_id', companyId)
    .order('issued_at', { ascending: false })
    .limit(1);
  if (error) {
    console.error('[safety-doc-status] undertaking query:', error);
    throw new Error('DOC_QUERY_FAILED');
  }
  const latest = (data ?? [])[0];
  if (!latest) return empty;

  const members: { name: string; birthDate: string | null; phone: string | null }[] = Array.isArray(
    latest.members
  )
    ? latest.members
    : [];
  const memberKeys = new Set(
    members.map((m) => personKey(m.name, m.birthDate ?? null, normalizePhone(m.phone)))
  );

  const periodValid = new Date(latest.expires_at).getTime() >= new Date(workEnd).getTime();

  const missingMembers: string[] = [];
  for (const p of participants) {
    const key = personKey(p.name, (p.birthDate ?? '').trim() || null, normalizePhone(p.phone));
    if (!memberKeys.has(key)) missingMembers.push((p.name ?? '').trim());
  }

  let status: UndertakingStatus;
  if (!periodValid) status = 'MISSING';
  else if (missingMembers.length > 0) status = 'STALE_MEMBERS';
  else status = 'VALID';

  return {
    status,
    expiresAt: latest.expires_at,
    workArea: latest.work_area ?? null,
    managerName: latest.manager_name ?? null,
    managerPhone: latest.manager_phone ?? null,
    members,
    missingMembers,
  };
}

export async function evaluateRequiredDocs(
  supabase: SupabaseClient,
  opts: { companyId: string; participants: DocPerson[]; workEnd: string }
): Promise<RequiredDocsResult> {
  const pledges: PledgeResult[] = [];
  for (const p of opts.participants) {
    pledges.push(await checkPledge(supabase, p, opts.workEnd));
  }
  const undertaking = await checkUndertaking(
    supabase,
    opts.companyId,
    opts.participants,
    opts.workEnd
  );
  const allValid =
    pledges.every((p) => p.status === 'VALID') && undertaking.status === 'VALID';
  return { allValid, pledges, undertaking };
}

export function sixMonthsLater(from?: Date): { issuedAt: string; expiresAt: string } {
  const issued = from ?? new Date();
  const exp = new Date(issued.getTime());
  exp.setMonth(exp.getMonth() + 6);
  return { issuedAt: issued.toISOString(), expiresAt: exp.toISOString() };
}

// ===== 양식 출력용 문서 데이터 수집 (xlsx/인쇄) =====
export interface DocsOutput {
  pledges: {
    name: string;
    companyName: string | null;
    birthDate: string | null;
    phone: string | null;
    nationality: string | null;
    bloodType: string | null;
    jobType: string | null;
    signature: string | null;
    workDate: string;
  }[];
  undertaking: {
    companyName: string | null;
    workArea: string | null;
    issuedAt: string | null;
    expiresAt: string | null;
    managerName: string | null;
    managerPhone: string | null;
    members: { name: string; birthDate: string | null; phone: string | null }[];
  } | null;
  eduResult: {
    date: string;
    content: string;
    names: string[];
  };
}

export async function getDocsForOutput(
  supabase: SupabaseClient,
  opts: {
    companyId: string | null;
    workStart: string;
    participants: { name: string; phone: string | null; companyName: string | null }[];
  }
): Promise<DocsOutput> {
  const pledges: DocsOutput['pledges'] = [];
  for (const p of opts.participants) {
    const name = (p.name ?? '').trim();
    const normPhone = normalizePhone(p.phone);
    let saved: any = null;
    if (name && normPhone) {
      const { data } = await supabase
        .from('safety_pledges')
        .select('birth_date, phone, company_name, nationality, blood_type, job_type, signature, issued_at')
        .eq('name', name)
        .eq('normalized_phone', normPhone)
        .order('issued_at', { ascending: false })
        .limit(1);
      saved = (data ?? [])[0] ?? null;
    }
    pledges.push({
      name,
      companyName: p.companyName ?? saved?.company_name ?? null,
      birthDate: saved?.birth_date ?? null,
      phone: p.phone ?? saved?.phone ?? null,
      nationality: saved?.nationality ?? null,
      bloodType: saved?.blood_type ?? null,
      jobType: saved?.job_type ?? null,
      signature: saved?.signature ?? null,
      workDate: opts.workStart,
    });
  }

  let undertaking: DocsOutput['undertaking'] = null;
  if (opts.companyId) {
    const { data } = await supabase
      .from('company_undertakings')
      .select('company_name, work_area, manager_name, manager_phone, members, issued_at, expires_at')
      .eq('company_id', opts.companyId)
      .order('issued_at', { ascending: false })
      .limit(1);
    const u = (data ?? [])[0];
    if (u) {
      undertaking = {
        companyName: u.company_name ?? null,
        workArea: u.work_area ?? null,
        issuedAt: u.issued_at ?? null,
        expiresAt: u.expires_at ?? null,
        managerName: u.manager_name ?? null,
        managerPhone: u.manager_phone ?? null,
        members: Array.isArray(u.members) ? u.members : [],
      };
    }
  }

  const eduResult: DocsOutput['eduResult'] = {
    date: opts.workStart,
    content: '신규 안전·보건 교육 이수 (작업 전 안전교육·TBM 포함)',
    names: opts.participants.map((p) => (p.name ?? '').trim()).filter(Boolean),
  };

  return { pledges, undertaking, eduResult };
}
