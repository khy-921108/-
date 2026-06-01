import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 작업허가 참여자 1명 본인확인 + 교육 유효성 판정.
 * - **작업 종료일 기준**: completions.expires_at >= workEnd 만 VALID.
 *   (신청일 기준 아님. 작업일에 교육이 만료되면 추가 불가)
 * - 클라이언트의 'valid' 주장 불신 — 항상 서버에서 재계산(이 함수).
 * - 명단 덤프 없음: (name + birth_date + phone) 단건 매칭만.
 *
 * 반환에는 스냅샷 저장에 필요한 원본 값(sessionId, companyId, 차량/장비/유효기간)을 포함.
 * (API 응답으로 내보낼 때는 호출자가 PII 마스킹/필드 선별)
 */

export type EligibilityStatus = 'VALID' | 'EXPIRED' | 'NONE';

export interface EligibilityResult {
  status: EligibilityStatus;
  name: string;
  // 스냅샷/표시용 (NONE 이면 대부분 null)
  sessionId: string | null;
  companyId: string | null;
  companyName: string | null;
  targetCode: string | null;
  targetLabel: string | null;
  vehicleNumber: string | null;
  spec: string | null;
  equipmentType: string | null;
  phone: string | null; // 원본(저장용) — API 응답에서는 마스킹할 것
  completedAt: string | null;
  expiresAt: string | null;
  /** 작업 종료일까지 남은 여유일(음수면 작업일에 이미 만료). NONE이면 null */
  marginDays: number | null;
}

function digits(s: unknown): string {
  return typeof s === 'string' ? s.replace(/[^0-9]/g, '') : '';
}

/**
 * @param workEnd ISO 문자열(작업 종료일시). 유효성 판정 기준.
 */
export async function evaluateParticipant(
  supabase: SupabaseClient,
  input: { name: string; birthDate: string; phone: string },
  workEnd: string
): Promise<EligibilityResult> {
  const name = (input.name ?? '').trim();
  const phone = digits(input.phone);
  const birthDate = (input.birthDate ?? '').trim();

  const base: EligibilityResult = {
    status: 'NONE',
    name,
    sessionId: null,
    companyId: null,
    companyName: null,
    targetCode: null,
    targetLabel: null,
    vehicleNumber: null,
    spec: null,
    equipmentType: null,
    phone: phone || null,
    completedAt: null,
    expiresAt: null,
    marginDays: null,
  };

  if (!name || !phone || !birthDate) return base;

  // 1. training_sessions 매칭 (이름+생년월일+전화 — 기존 lookup 보안모델과 동일)
  const { data: sessions, error: sessErr } = await supabase
    .from('training_sessions')
    .select(
      `id, name, affiliation, company_id, birth_date, phone, vehicle_number, spec, equipment_type,
       target_types ( code, label )`
    )
    .eq('phone', phone)
    .eq('birth_date', birthDate)
    .eq('name', name)
    .order('created_at', { ascending: false });

  if (sessErr) {
    console.error('[participant-eligibility] sessions error:', sessErr);
    throw new Error('ELIGIBILITY_QUERY_FAILED');
  }
  if (!sessions || sessions.length === 0) return base;

  const sessionIds = sessions.map((s: any) => s.id);

  // 2. completions (가장 최근 수료)
  const { data: comps, error: compErr } = await supabase
    .from('completions')
    .select('session_id, completed_at, expires_at')
    .in('session_id', sessionIds)
    .order('completed_at', { ascending: false });

  if (compErr) {
    console.error('[participant-eligibility] completions error:', compErr);
    throw new Error('ELIGIBILITY_QUERY_FAILED');
  }
  if (!comps || comps.length === 0) {
    // 세션은 있으나 수료 없음 → NONE (스냅샷 일부는 채워둠)
    const s0: any = sessions[0];
    const tt0 = Array.isArray(s0.target_types) ? s0.target_types[0] : s0.target_types;
    return {
      ...base,
      sessionId: s0.id,
      companyId: s0.company_id ?? null,
      companyName: s0.affiliation ?? null,
      targetCode: tt0?.code ?? null,
      targetLabel: tt0?.label ?? null,
      vehicleNumber: s0.vehicle_number ?? null,
      spec: s0.spec ?? null,
      equipmentType: s0.equipment_type ?? null,
    };
  }

  const latest = comps[0];
  const session: any =
    sessions.find((s: any) => s.id === latest.session_id) ?? sessions[0];
  const tt = Array.isArray(session.target_types)
    ? session.target_types[0]
    : session.target_types;

  // 3. 작업 종료일 기준 판정
  const expiresTs = new Date(latest.expires_at).getTime();
  const workEndTs = new Date(workEnd).getTime();
  const validByWorkEnd = !isNaN(workEndTs) && expiresTs >= workEndTs;

  const marginDays = !isNaN(workEndTs)
    ? Math.floor((expiresTs - workEndTs) / (1000 * 60 * 60 * 24))
    : null;

  return {
    status: validByWorkEnd ? 'VALID' : 'EXPIRED',
    name,
    sessionId: session.id,
    companyId: session.company_id ?? null,
    companyName: session.affiliation ?? null,
    targetCode: tt?.code ?? null,
    targetLabel: tt?.label ?? null,
    vehicleNumber: session.vehicle_number ?? null,
    spec: session.spec ?? null,
    equipmentType: session.equipment_type ?? null,
    phone: phone || null,
    completedAt: latest.completed_at,
    expiresAt: latest.expires_at,
    marginDays,
  };
}
