/**
 * 업체 통합 인원현황 — "사람 기준" 병합 로스터.
 * - ① 마스터: company_members(company_id) — 차량·장비·톤수.
 * - ② 교육: training_sessions(company_id) + completions — 수료일·유효기간.
 * - 병합 키: 정규화 name(trim) + birth_date + normalized_phone(숫자만).
 *   **강한 키(생일 AND 전화 모두 존재)일 때만 병합.** 약하면(둘 중 하나라도 NULL) 별도 행 → 오병합 방지.
 * - 교육상태(now 기준): 유효(>7일) / 만료예정(≤7일) / 만료(지남) / 미이수(수료 없음).
 * - members GET·per-company export 가 공유(화면 뱃지 = 엑셀 = 동일 기준).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhone, type EquipmentType, type MemberType } from './equipment';

export type CompletionStatus = 'VALID' | 'EXPIRING7' | 'EXPIRED' | 'NONE';
export type RosterSource = 'BOTH' | 'MASTER' | 'TRAINING';

export interface RosterItem {
  id: string | null; // company_members.id (null = 교육만 받은 사람)
  member_type: MemberType | null; // 교육만인 경우 null
  name: string;
  birth_date: string | null;
  phone: string | null;
  vehicle_number: string | null;
  equipment_type: EquipmentType | null;
  equipment_type_etc: string | null;
  spec: string | null;
  note: string | null;
  source: RosterSource; // BOTH=마스터+교육 / MASTER=마스터만 / TRAINING=교육만
  completion_status: CompletionStatus;
  completed_at: string | null;
  expires_at: string | null;
}

export interface RosterStats {
  total: number;
  valid: number;
  expiring7: number;
  expired: number;
  none: number;
  vehicleCount: number;
  equipmentCount: number;
}

export interface CompanyInfo {
  id: string;
  name: string;
  biz_no: string | null;
  company_type: string;
  manager_name: string | null;
  phone: string | null;
  status: string;
  created_by: string | null;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CompanyRoster {
  company: CompanyInfo;
  items: RosterItem[];
  stats: RosterStats;
}

export type RosterResult =
  | { ok: true; roster: CompanyRoster }
  | { ok: false; status: number; code: string; message: string };

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

function keyOf(name: string, birth: string | null, normPhone: string | null): string {
  return `${(name || '').trim()}||${birth || ''}||${normPhone || ''}`;
}
/** 강한 키 = 생년월일 AND 정규화전화 둘 다 존재 */
function isStrong(birth: string | null, normPhone: string | null): boolean {
  return !!birth && !!normPhone;
}

/**
 * 업체 통합 로스터 산출. 관리자 전용 호출(라우트에서 requireAdmin 후).
 * companyId 범위만 조회 — 타업체 데이터 미접근.
 */
export async function getCompanyRoster(
  supabase: SupabaseClient,
  companyId: string
): Promise<RosterResult> {
  // 1. 업체
  const { data: company, error: cErr } = await supabase
    .from('companies')
    .select(
      'id, name, biz_no, company_type, manager_name, phone, status, created_by, note, created_at, updated_at'
    )
    .eq('id', companyId)
    .maybeSingle();
  if (cErr) return { ok: false, status: 500, code: 'QUERY_FAILED', message: cErr.message };
  if (!company) return { ok: false, status: 404, code: 'NOT_FOUND', message: '업체를 찾을 수 없습니다.' };

  // 2. 마스터 인원
  const { data: members, error: mErr } = await supabase
    .from('company_members')
    .select(
      'id, member_type, name, birth_date, phone, normalized_phone, vehicle_number, equipment_type, equipment_type_etc, spec, note'
    )
    .eq('company_id', companyId)
    .limit(5000);
  if (mErr) return { ok: false, status: 500, code: 'QUERY_FAILED', message: mErr.message };

  // 3. 이 업체 교육 세션
  const { data: sessions, error: sErr } = await supabase
    .from('training_sessions')
    .select('id, name, birth_date, phone, created_at')
    .eq('company_id', companyId)
    .limit(10000);
  if (sErr) return { ok: false, status: 500, code: 'QUERY_FAILED', message: sErr.message };

  // 4. 세션별 최신 수료(completed_at 최신)
  const sessionIds = (sessions ?? []).map((s: any) => s.id);
  const completionBySession = new Map<string, { expires_at: string; completed_at: string }>();
  for (let i = 0; i < sessionIds.length; i += 500) {
    const chunk = sessionIds.slice(i, i + 500);
    const { data: comps, error: compErr } = await supabase
      .from('completions')
      .select('session_id, completed_at, expires_at')
      .in('session_id', chunk);
    if (compErr) return { ok: false, status: 500, code: 'QUERY_FAILED', message: compErr.message };
    (comps ?? []).forEach((c: any) => {
      if (!c.expires_at) return;
      const prev = completionBySession.get(c.session_id);
      if (!prev || new Date(c.completed_at).getTime() > new Date(prev.completed_at).getTime()) {
        completionBySession.set(c.session_id, { expires_at: c.expires_at, completed_at: c.completed_at });
      }
    });
  }

  const now = Date.now();
  const statusFor = (expires: string | null): CompletionStatus => {
    if (!expires) return 'NONE';
    const ts = new Date(expires).getTime();
    if (ts <= now) return 'EXPIRED';
    if (ts - now <= SEVEN_DAYS) return 'EXPIRING7';
    return 'VALID';
  };

  const items: RosterItem[] = [];
  const strongIndex = new Map<string, RosterItem>(); // 강한키 → 마스터 행 (병합 대상)

  // 5. 마스터 행 생성
  for (const m of members ?? []) {
    const row: RosterItem = {
      id: m.id,
      member_type: m.member_type,
      name: m.name,
      birth_date: m.birth_date,
      phone: m.phone,
      vehicle_number: m.vehicle_number,
      equipment_type: m.equipment_type,
      equipment_type_etc: m.equipment_type_etc,
      spec: m.spec,
      note: m.note,
      source: 'MASTER',
      completion_status: 'NONE',
      completed_at: null,
      expires_at: null,
    };
    items.push(row);
    if (isStrong(m.birth_date, m.normalized_phone)) {
      strongIndex.set(keyOf(m.name, m.birth_date, m.normalized_phone), row);
    }
  }

  // 6. 교육 인원 그룹화(사람별 최선 수료 = expires_at 최대)
  interface TP {
    name: string;
    birth: string | null;
    phone: string | null;
    normPhone: string | null;
    strong: boolean;
    bestExpires: string | null;
    bestCompleted: string | null;
  }
  const trainingPersons = new Map<string, TP>();
  for (const s of sessions ?? []) {
    const normPhone = normalizePhone(s.phone);
    const gk = keyOf(s.name, s.birth_date, normPhone);
    let tp = trainingPersons.get(gk);
    if (!tp) {
      tp = {
        name: s.name,
        birth: s.birth_date,
        phone: s.phone,
        normPhone,
        strong: isStrong(s.birth_date, normPhone),
        bestExpires: null,
        bestCompleted: null,
      };
      trainingPersons.set(gk, tp);
    }
    const comp = completionBySession.get(s.id);
    if (comp && (!tp.bestExpires || new Date(comp.expires_at).getTime() > new Date(tp.bestExpires).getTime())) {
      tp.bestExpires = comp.expires_at;
      tp.bestCompleted = comp.completed_at;
    }
  }

  // 7. 교육 인원을 마스터에 병합(강한키 일치 시) 또는 별도 행
  for (const [gk, tp] of trainingPersons) {
    const target = tp.strong ? strongIndex.get(gk) ?? null : null;
    if (target) {
      target.source = 'BOTH';
      target.completion_status = statusFor(tp.bestExpires);
      target.expires_at = tp.bestExpires;
      target.completed_at = tp.bestCompleted;
    } else {
      items.push({
        id: null,
        member_type: null,
        name: tp.name,
        birth_date: tp.birth,
        phone: tp.phone,
        vehicle_number: null,
        equipment_type: null,
        equipment_type_etc: null,
        spec: null,
        note: null,
        source: 'TRAINING',
        completion_status: statusFor(tp.bestExpires),
        completed_at: tp.bestCompleted,
        expires_at: tp.bestExpires,
      });
    }
  }

  // 8. 이름순 정렬(ICU 비의존 — 코드포인트 비교)
  items.sort((a, b) => {
    const an = a.name || '';
    const bn = b.name || '';
    return an < bn ? -1 : an > bn ? 1 : 0;
  });

  // 9. 카운트(합 = 인원수)
  const stats: RosterStats = {
    total: items.length,
    valid: 0,
    expiring7: 0,
    expired: 0,
    none: 0,
    vehicleCount: 0,
    equipmentCount: 0,
  };
  for (const it of items) {
    if (it.completion_status === 'VALID') stats.valid += 1;
    else if (it.completion_status === 'EXPIRING7') stats.expiring7 += 1;
    else if (it.completion_status === 'EXPIRED') stats.expired += 1;
    else stats.none += 1;
    if (it.vehicle_number) stats.vehicleCount += 1;
    if (it.equipment_type) stats.equipmentCount += 1;
  }

  return { ok: true, roster: { company: company as CompanyInfo, items, stats } };
}
