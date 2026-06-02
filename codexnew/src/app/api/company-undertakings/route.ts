import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/equipment';
import { sixMonthsLater } from '@/lib/safety-doc-status';

/**
 * POST /api/company-undertakings  (공개) — 업체 안전작업 이행각서(#9) 발급/재발급
 * req: { companyId, workArea?, managerName, managerPhone, members:[{name,birthDate,phone}] }
 * - 6개월 블랭킷. 새 행 INSERT(최신이 유효본). 대표/현장소장 인은 현장(앱 미입력).
 * - members = 기존 최신 각서 명단 ∪ 이번 요청 명단(중복 제거). company_members 전체 덤프 안 함.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const companyId =
      typeof body.companyId === 'string' && body.companyId.trim() ? body.companyId.trim() : null;
    const workArea = (typeof body.workArea === 'string' ? body.workArea : '').trim() || '울산공장 구내 작업';
    const managerName = (typeof body.managerName === 'string' ? body.managerName : '').trim();
    const managerPhone = (typeof body.managerPhone === 'string' ? body.managerPhone : '').replace(/[^0-9]/g, '');
    const membersIn: any[] = Array.isArray(body.members) ? body.members : [];

    if (!companyId) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '업체 정보가 필요합니다.' },
        { status: 400 }
      );
    }
    if (!managerName) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '관리감독자명을 입력해 주세요.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // 업체명 스냅샷
    const { data: company } = await supabase.from('companies').select('name').eq('id', companyId).maybeSingle();
    const companyName = company?.name ?? null;

    // 기존 최신 각서 명단 가져와 병합(누적)
    const { data: prev } = await supabase
      .from('company_undertakings')
      .select('members')
      .eq('company_id', companyId)
      .order('issued_at', { ascending: false })
      .limit(1);
    const prevMembers: any[] = Array.isArray(prev?.[0]?.members) ? prev![0].members : [];

    // 정규화 + 병합 + 중복 제거(name+birth+normphone)
    const norm = (m: any) => ({
      name: (m?.name ?? '').trim(),
      birthDate: (m?.birthDate ?? '').trim() || null,
      phone: (m?.phone ?? '').toString().replace(/[^0-9]/g, '') || null,
    });
    const key = (m: { name: string; birthDate: string | null; phone: string | null }) =>
      `${m.name}||${m.birthDate ?? ''}||${normalizePhone(m.phone) ?? ''}`;

    const merged = new Map<string, { name: string; birthDate: string | null; phone: string | null }>();
    for (const m of [...prevMembers, ...membersIn]) {
      const nm = norm(m);
      if (!nm.name) continue;
      merged.set(key(nm), nm);
    }
    const members = Array.from(merged.values());

    const { issuedAt, expiresAt } = sixMonthsLater();

    const { data, error } = await supabase
      .from('company_undertakings')
      .insert({
        company_id: companyId,
        company_name: companyName,
        work_area: workArea,
        manager_name: managerName,
        manager_phone: managerPhone || null,
        members,
        issued_at: issuedAt,
        expires_at: expiresAt,
      })
      .select('id, expires_at')
      .single();

    if (error || !data) {
      console.error('[company-undertakings POST] error:', error);
      return NextResponse.json(
        { success: false, code: 'SAVE_FAILED', message: '이행각서 발급에 실패했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { undertakingId: data.id, expiresAt: data.expires_at, memberCount: members.length },
    });
  } catch (e) {
    console.error('[company-undertakings POST] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
