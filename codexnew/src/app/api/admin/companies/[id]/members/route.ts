import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/equipment';

/**
 * GET /api/admin/companies/:id/members
 * - 어드민 전용 (PII 포함).
 * - 업체 소속 인원 목록 + 각 인원의 수료 유효 상태 매칭.
 * - 매칭 키: (name, birth_date, normalized_phone) 를 training_sessions 와 비교 후 completions 의 expires_at 으로 판정.
 * - 상태: VALID / EXPIRING7 / EXPIRED / NONE
 */
export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const companyId = ctx.params.id;
  const supabase = createServiceClient();

  const { data: company, error: companyErr } = await supabase
    .from('companies')
    .select('id, name, biz_no, company_type, manager_name, phone, status, note, created_at, updated_at')
    .eq('id', companyId)
    .maybeSingle();
  if (companyErr) {
    console.error('[admin/companies/:id/members] company:', companyErr);
    return NextResponse.json(
      { success: false, code: 'QUERY_FAILED', message: companyErr.message },
      { status: 500 }
    );
  }
  if (!company) {
    return NextResponse.json(
      { success: false, code: 'NOT_FOUND', message: '업체를 찾을 수 없습니다.' },
      { status: 404 }
    );
  }

  // 1. 업체 인원
  const { data: members, error: membersErr } = await supabase
    .from('company_members')
    .select(
      'id, member_type, name, birth_date, phone, normalized_phone, vehicle_number, equipment_type, equipment_type_etc, spec, note, created_at'
    )
    .eq('company_id', companyId)
    .order('name', { ascending: true })
    .limit(2000);
  if (membersErr) {
    console.error('[admin/companies/:id/members] members:', membersErr);
    return NextResponse.json(
      { success: false, code: 'QUERY_FAILED', message: membersErr.message },
      { status: 500 }
    );
  }

  // 2. 인원 (name+birth+normalizedPhone) → 매칭되는 training_sessions 의 최신 수료 expires_at 산출
  const memberList = members ?? [];
  const stats = {
    total: memberList.length,
    valid: 0,
    expiring7: 0,
    expired: 0,
    none: 0,
    vehicleCount: 0,
    equipmentCount: 0,
  };

  // 한꺼번에 매칭하기 위해 인원 이름들만 모아서 sessions 조회
  const uniqueNames = Array.from(new Set(memberList.map((m: any) => m.name)));
  let sessionsByKey = new Map<string, { sessionId: string; createdAt: string }[]>();
  if (uniqueNames.length > 0) {
    const { data: sessions, error: sessErr } = await supabase
      .from('training_sessions')
      .select('id, name, birth_date, phone, created_at')
      .in('name', uniqueNames)
      .order('created_at', { ascending: false })
      .limit(5000);
    if (sessErr) {
      console.error('[admin/companies/:id/members] sessions:', sessErr);
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: sessErr.message },
        { status: 500 }
      );
    }
    (sessions ?? []).forEach((s: any) => {
      const key = makeKey(s.name, s.birth_date, normalizePhone(s.phone));
      const arr = sessionsByKey.get(key) ?? [];
      arr.push({ sessionId: s.id, createdAt: s.created_at });
      sessionsByKey.set(key, arr);
    });
  }

  // 매칭된 세션들의 최신 수료 정보 한꺼번에 조회
  const matchedSessionIds: string[] = [];
  for (const m of memberList) {
    const key = makeKey(m.name, m.birth_date, m.normalized_phone);
    const arr = sessionsByKey.get(key);
    if (arr && arr.length > 0) matchedSessionIds.push(...arr.map((a) => a.sessionId));
  }

  let completionBySessionId = new Map<string, { expires_at: string; completed_at: string }>();
  if (matchedSessionIds.length > 0) {
    const { data: comps, error: compErr } = await supabase
      .from('completions')
      .select('session_id, completed_at, expires_at')
      .in('session_id', matchedSessionIds);
    if (compErr) {
      console.error('[admin/companies/:id/members] completions:', compErr);
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: compErr.message },
        { status: 500 }
      );
    }
    (comps ?? []).forEach((c: any) => {
      const prev = completionBySessionId.get(c.session_id);
      if (!prev || new Date(c.completed_at) > new Date(prev.completed_at)) {
        completionBySessionId.set(c.session_id, c);
      }
    });
  }

  // 3. 각 인원에 상태 부여
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

  const items = memberList.map((m: any) => {
    const key = makeKey(m.name, m.birth_date, m.normalized_phone);
    const sessions = sessionsByKey.get(key) ?? [];
    // 가장 최근에 수료된 세션 찾기
    let bestCompletion: { expires_at: string; completed_at: string } | undefined;
    for (const s of sessions) {
      const c = completionBySessionId.get(s.sessionId);
      if (c) {
        if (!bestCompletion || new Date(c.completed_at) > new Date(bestCompletion.completed_at)) {
          bestCompletion = c;
        }
      }
    }

    let status: 'VALID' | 'EXPIRING7' | 'EXPIRED' | 'NONE' = 'NONE';
    let expiresAt: string | null = null;
    if (bestCompletion) {
      expiresAt = bestCompletion.expires_at;
      const expiresTs = new Date(bestCompletion.expires_at).getTime();
      if (expiresTs <= now) status = 'EXPIRED';
      else if (expiresTs - now <= SEVEN_DAYS) status = 'EXPIRING7';
      else status = 'VALID';
    }

    if (status === 'VALID') stats.valid += 1;
    else if (status === 'EXPIRING7') stats.expiring7 += 1;
    else if (status === 'EXPIRED') stats.expired += 1;
    else stats.none += 1;

    if (m.vehicle_number) stats.vehicleCount += 1;
    if (m.equipment_type) stats.equipmentCount += 1;

    return {
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
      completion_status: status,
      expires_at: expiresAt,
    };
  });

  return NextResponse.json({
    success: true,
    data: {
      company,
      items,
      stats,
    },
  });
}

function makeKey(name: string, birthDate: string | null, normalizedPhone: string | null): string {
  return `${name}||${birthDate ?? ''}||${normalizedPhone ?? ''}`;
}
