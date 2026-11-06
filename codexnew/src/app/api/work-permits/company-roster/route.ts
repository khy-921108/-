import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { ApplicantQueryError, resolveApplicantCompany } from '@/lib/applicant-company';
import { isPersonRefEnabled, personIdOf, personKey, sealPersonRef } from '@/lib/person-ref';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const VERIFY_WINDOW_MS = 30 * 60 * 1000;
const PAGE_SIZE = 1000;
const ID_CHUNK = 200;

const digits = (s: unknown) => (typeof s === 'string' ? s.replace(/[^0-9]/g, '') : '');

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

function queryFailed(where: string, error: unknown): never {
  console.error(`[company-roster] ${where}:`, error);
  throw new ApplicantQueryError();
}

/** 조회 상한에 잘리지 않게 끝까지 읽는다. */
async function readAll(
  where: string,
  page: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: unknown }>
): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) queryFailed(where, error);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += ID_CHUNK) out.push(list.slice(i, i + ID_CHUNK));
  return out;
}

/**
 * POST /api/work-permits/company-roster  (공개) — 신청인 소속 업체 수료자 목록
 * req: { applicant:{name,birthDate,phone}, workEnd }
 * res: { success, data:{ items:[{name,birthYear,phoneLast4,targetLabel,expiresAt,ref,personId}] } }
 *
 * - 업체는 서버가 신청인 교육 기록으로 정한다. 요청의 companyId 는 읽지 않는다.
 * - 신청인 문자 인증(최근 30분) 필수. 사용중지·숨김 업체는 거부.
 * - 가장 최근 수료(evaluateParticipant 기준)가 이 업체 세션이고 작업 종료일까지 유효한 사람만 나온다.
 * - 전체 번호·생년월일·세션 id·차량번호는 응답에 넣지 않는다. 조회마다 기록을 남긴다.
 */
export async function POST(req: Request) {
  try {
    if (!isPersonRefEnabled()) {
      return fail('ROSTER_DISABLED', '지금은 불러오기를 사용할 수 없습니다. 아래에서 직접 입력해 주세요.', 503);
    }

    const body = await req.json().catch(() => ({}));
    const applicant = body?.applicant ?? {};
    const name = (typeof applicant.name === 'string' ? applicant.name : '').trim();
    const birthDate = (typeof applicant.birthDate === 'string' ? applicant.birthDate : '').trim();
    const phone = (typeof applicant.phone === 'string' ? applicant.phone : '').replace(/[^0-9]/g, '');
    const workEnd = typeof body?.workEnd === 'string' ? body.workEnd : '';

    const workEndTs = new Date(workEnd).getTime();
    if (!workEnd || isNaN(workEndTs)) {
      return fail('NO_WORK_END', '작업 종료일시가 필요합니다. 작업정보를 먼저 입력해 주세요.', 400);
    }
    if (!name || !birthDate || phone.length < 10) {
      return fail('INVALID_INPUT', '신청인 정보를 다시 확인해 주세요.', 400);
    }

    const supabase = createServiceClient();

    const who = await resolveApplicantCompany(supabase, { name, birthDate, phone });
    if (who.status === 'NO_EDU') {
      return fail('NO_EDU', '신청인의 유효한 교육 이력이 없습니다. 아래에서 직접 입력해 주세요.', 403);
    }
    if (who.status === 'NO_COMPANY') {
      return fail('NO_COMPANY', '신청인 소속 업체를 사용할 수 없습니다. 아래에서 직접 입력해 주세요.', 403);
    }

    const verifiedSince = new Date(Date.now() - VERIFY_WINDOW_MS).toISOString();
    const { data: verified, error: verifyErr } = await supabase
      .from('phone_verifications')
      .select('id')
      .eq('phone', phone)
      .not('verified_at', 'is', null)
      .gte('verified_at', verifiedSince)
      .limit(1)
      .maybeSingle();
    if (verifyErr) {
      console.error('[company-roster] phone check:', verifyErr);
      return fail('QUERY_FAILED', '조회 중 오류가 발생했습니다.', 500);
    }
    if (!verified) {
      return fail('PHONE_NOT_VERIFIED', '휴대폰 문자 인증을 먼저 완료해 주세요.', 403);
    }

    const companyId = who.company.id;

    // 이 업체 세션이 있는 사람들의 번호
    const companySessions = await readAll('company sessions', (from, to) =>
      supabase
        .from('training_sessions')
        .select('id, phone')
        .eq('company_id', companyId)
        .order('id')
        .range(from, to)
    );
    const phones = Array.from(new Set(companySessions.map((s) => digits(s.phone)).filter(Boolean)));

    // 그 사람들의 전체 세션(다른 업체 포함). evaluateParticipant 와 같이 숫자 번호로 찾는다.
    const sessions: any[] = [];
    for (const part of chunks(phones)) {
      sessions.push(
        ...(await readAll('person sessions', (from, to) =>
          supabase
            .from('training_sessions')
            .select('id, name, birth_date, phone, company_id, target_types ( label )')
            .in('phone', part)
            .order('id')
            .range(from, to)
        ))
      );
    }

    // 전체 수료. 세션당 1건이라 묶음이 조회 상한을 넘지 않는다.
    const completions: any[] = [];
    for (const part of chunks(sessions.map((s) => s.id))) {
      const { data, error } = await supabase
        .from('completions')
        .select('session_id, completed_at, expires_at')
        .in('session_id', part);
      if (error) queryFailed('completions', error);
      completions.push(...(data ?? []));
    }

    // 사람마다 가장 최근 수료 1건
    const sessionById = new Map(sessions.map((s) => [s.id, s]));
    const latest = new Map<string, { session: any; completion: any }>();
    for (const c of completions) {
      const s = sessionById.get(c.session_id);
      if (!s) continue;
      const key = personKey({ name: s.name, birthDate: s.birth_date, phone: s.phone });
      const prev = latest.get(key);
      if (!prev || new Date(c.completed_at) > new Date(prev.completion.completed_at)) {
        latest.set(key, { session: s, completion: c });
      }
    }

    // 그 수료가 이 업체 세션이고 작업 종료일까지 유효한 사람만. 신청인 본인 제외.
    const applicantKey = personKey({ name, birthDate, phone });
    const items = Array.from(latest.entries())
      .filter(
        ([key, { session: s, completion: c }]) =>
          key !== applicantKey &&
          s.company_id === companyId &&
          new Date(c.expires_at).getTime() >= workEndTs
      )
      .map(([, { session: s, completion: c }]) => {
        const person = { name: s.name, birthDate: s.birth_date, phone: s.phone };
        const tt = Array.isArray(s.target_types) ? s.target_types[0] : s.target_types;
        return {
          name: s.name as string,
          birthYear: String(s.birth_date).slice(0, 4),
          phoneLast4: String(s.phone).replace(/[^0-9]/g, '').slice(-4),
          targetLabel: (tt?.label ?? null) as string | null,
          expiresAt: c.expires_at as string,
          ref: sealPersonRef({ ...person, companyId }),
          personId: personIdOf(person),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    // 기록을 남기지 못하면 목록을 내주지 않는다.
    const { error: logErr } = await supabase.from('company_roster_access_logs').insert({
      applicant_name: name,
      applicant_phone: phone,
      company_id: companyId,
      result_count: items.length,
    });
    if (logErr) {
      console.error('[company-roster] access log:', logErr);
      return fail('LOG_FAILED', '조회 기록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.', 500);
    }

    return NextResponse.json({ success: true, data: { items } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof ApplicantQueryError) return fail('QUERY_FAILED', '조회 중 오류가 발생했습니다.', 500);
    console.error('[company-roster] unexpected:', e);
    return fail('SERVER_ERROR', '서버 오류가 발생했습니다.', 500);
  }
}
