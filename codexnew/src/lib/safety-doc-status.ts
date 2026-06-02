import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone } from './equipment';

/**
 * 1C-2 필수문서(개인서약·업체이행각서) 6개월 유효성 — **작업종료일 기준**.
 * - 개인서약: (name+birth+normalized_phone) 최신 발급, expires_at >= workEnd 면 VALID.
 * - 이행각서: 업체 최신 발급이 기간 유효(expires_at >= workEnd) AND 모든 참여자 ∈ members 면 VALID.
 *   기간은 유효하나 신규 인원이 members에 없으면 STALE_MEMBERS(명단추가→재발급 필요).
 * - 클라이언트 'docs 완료' 주장 불신 — 항상 서버 재계산(이 모듈).
 */

export interface DocPerson {
  name: string;
  birthDate: string; // YYYY-MM-DD
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
  /** STALE_MEMBERS 일 때 members에 없는 참여자 이름들 */
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

/** 개인서약 1명 — 최신 발급 + 작업종료일 기준 유효성 */
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

  let q = supabase
    .from('safety_pledges')
    .select('nationality, blood_type, job_type, expires_at, issued_at')
    .eq('name', name)
    .eq('birth_date', birthDate)
    .eq('normalized_phone', normPhone)
    .order('issued_at', { ascending: false })
    .limit(1);

  const { data, error } = await q;
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
    saved: valid
      ? {
          nationality: latest.nationality ?? null,
          bloodType: latest.blood_type ?? null,
          jobType: latest.job_type ?? null,
        }
      : {
          // 만료(MISSING)여도 직전 입력값을 인라인 작성에 프리필하도록 전달
          nationality: latest.nationality ?? null,
          bloodType: latest.blood_type ?? null,
          jobType: latest.job_type ?? null,
        },
  };
}

/** 업체 이행각서 — 최신 발급, 기간 + 참여자 명단 커버 검증 */
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

/** 필수문서 종합 — 모든 참여자 서약 + 업체 각서 (제출 게이트·status 화면 공용) */
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

/** 6개월 뒤 만료시각 ISO */
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
    workDate: string; // ISO (출입일자 = 작업 시작일)
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

/**
 * 작업허가서의 참여자/업체 기준으로 출력에 채울 필수문서 데이터 수집.
 * - 개인서약: 참여자별 최신 safety_pledge (name+normalized_phone) → 저장값 사용.
 * - 이행각서: 업체 최신 company_undertaking.
 * - 교육결과서: 참여자 명단 + 작업일/고정 문구.
 * 출력 전용(검증 아님)이라 name+normalized_phone 매칭. 다른 업체 데이터 조회 안 함.
 */
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
        .select('birth_date, phone, company_name, nationality, blood_type, job_type, issued_at')
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
