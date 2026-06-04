/**
 * ① 교육 수료 시 자동 명단 등록.
 * - 교육 수료 세션의 사람을 그 업체 인원 명단(company_members)에 자동 등록.
 * - company_id 가 있을 때만. ON CONFLICT DO NOTHING(기존·어드민 수정분 절대 안 덮어씀).
 * - 화물차/중장비면 차량번호·장비종류·spec 포함. member_type 은 target_types.code 에서 매핑.
 *
 * 🔴 비차단 원칙: 이 함수는 내부에서 모든 예외를 삼키고 결과만 반환한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone, type MemberType } from './equipment';

export type AutoRegisterResult =
  | { registered: true; duplicate: boolean }
  | { registered: false; reason: 'NO_SESSION' | 'NO_COMPANY' | 'NO_NAME' | 'ERROR' };

/** target_types.code → company_members.member_type (WORKER/TRUCK/HEAVY) */
function toMemberType(code: string | null | undefined): MemberType {
  if (code === 'TRUCK') return 'TRUCK';
  if (code === 'HEAVY') return 'HEAVY';
  return 'WORKER';
}

export async function autoRegisterFromSession(
  supabase: SupabaseClient,
  sessionId: string
): Promise<AutoRegisterResult> {
  try {
    const { data: s, error } = await supabase
      .from('training_sessions')
      .select(
        'name, birth_date, phone, company_id, vehicle_number, spec, equipment_type, equipment_type_etc, target_type_id'
      )
      .eq('id', sessionId)
      .maybeSingle();
    if (error) throw error;
    if (!s) return { registered: false, reason: 'NO_SESSION' };
    if (!s.company_id) return { registered: false, reason: 'NO_COMPANY' };
    const name = (s.name ?? '').trim();
    if (!name) return { registered: false, reason: 'NO_NAME' };

    let memberType: MemberType = 'WORKER';
    if (s.target_type_id) {
      const { data: tt } = await supabase
        .from('target_types')
        .select('code')
        .eq('id', s.target_type_id)
        .maybeSingle();
      memberType = toMemberType(tt?.code);
    }

    const values = {
      company_id: s.company_id,
      member_type: memberType,
      name,
      birth_date: s.birth_date ?? null,
      phone: s.phone ?? null,
      normalized_phone: normalizePhone(s.phone),
      vehicle_number: s.vehicle_number ?? null,
      equipment_type: s.equipment_type ?? null,
      equipment_type_etc: s.equipment_type_etc ?? null,
      spec: s.spec ?? null,
    };

    const { data, error: upErr } = await supabase
      .from('company_members')
      .upsert(values, {
        onConflict: 'company_id,name,birth_date,normalized_phone',
        ignoreDuplicates: true,
      })
      .select('id');
    if (upErr) throw upErr;

    const inserted = Array.isArray(data) && data.length > 0;
    return { registered: true, duplicate: !inserted };
  } catch (e) {
    console.error('[auto-roster] 무시(비차단):', e);
    return { registered: false, reason: 'ERROR' };
  }
}
