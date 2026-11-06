import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 신청인 본인 + 소속 업체 판정. verify-applicant 와 업체 수료자 불러오기가 같은 기준을 쓴다.
 * - OK         = 유효 수료 있음 AND 업체 연결됨(사용중지·숨김 업체 제외)
 * - NO_EDU     = 유효 수료 없음
 * - NO_COMPANY = 수료는 있으나 업체 미연결 또는 사용중지·숨김 업체
 * 업체는 유효 수료가 속한 세션의 company_id 를 우선하고, 없으면 최근 세션 중 업체가 있는 것을 쓴다.
 */

export type ApplicantResult =
  | { status: 'NO_EDU' }
  | { status: 'NO_COMPANY'; completedAt: string; expiresAt: string }
  | {
      status: 'OK';
      company: { id: string; name: string };
      completedAt: string;
      expiresAt: string;
    };

export class ApplicantQueryError extends Error {
  constructor() {
    super('APPLICANT_QUERY_FAILED');
  }
}

export async function resolveApplicantCompany(
  supabase: SupabaseClient,
  input: { name: string; birthDate: string; phone: string }
): Promise<ApplicantResult> {
  const { name, birthDate, phone } = input;

  const { data: sessions, error: sessErr } = await supabase
    .from('training_sessions')
    .select('id, name, affiliation, company_id, created_at')
    .eq('phone', phone)
    .eq('birth_date', birthDate)
    .eq('name', name)
    .order('created_at', { ascending: false });

  if (sessErr) {
    console.error('[applicant-company] sessions:', sessErr);
    throw new ApplicantQueryError();
  }
  if (!sessions || sessions.length === 0) return { status: 'NO_EDU' };

  const sessionIds = sessions.map((s: any) => s.id);
  const { data: comps, error: compErr } = await supabase
    .from('completions')
    .select('session_id, completed_at, expires_at')
    .in('session_id', sessionIds)
    .order('completed_at', { ascending: false });

  if (compErr) {
    console.error('[applicant-company] completions:', compErr);
    throw new ApplicantQueryError();
  }

  const now = Date.now();
  const validComp = (comps ?? []).find((c: any) => new Date(c.expires_at).getTime() > now);
  if (!validComp) return { status: 'NO_EDU' };

  const validSession = sessions.find((s: any) => s.id === validComp.session_id) ?? sessions[0];
  let companyId: string | null = validSession.company_id ?? null;
  if (!companyId) {
    const withCompany = sessions.find((s: any) => s.company_id);
    companyId = withCompany?.company_id ?? null;
  }

  const dates = { completedAt: validComp.completed_at, expiresAt: validComp.expires_at };
  if (!companyId) return { status: 'NO_COMPANY', ...dates };

  const { data: company } = await supabase
    .from('companies')
    .select('id, name, status, archived_at')
    .eq('id', companyId)
    .maybeSingle();

  if (!company || company.status === 'DISABLED' || company.archived_at) {
    return { status: 'NO_COMPANY', ...dates };
  }

  return { status: 'OK', company: { id: company.id, name: company.name }, ...dates };
}
