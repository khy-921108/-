import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/equipment';

/**
 * POST /api/safety-pledges/my-unsigned  (공개) — 셀프서명용: 본인 "미서명 유효 개인서약" 목록
 * req: { name, birthDate, phone }
 * res: { success, data:{ items:[{pledgeId, companyName, issuedAt, expiresAt}] } }
 * - 본인(name+birth_date+normalized_phone) 일치 + signature NULL + 미만료(expires_at>=now) 만.
 * - 타인 서약 조회 금지(본인키 매칭만).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = (typeof body.name === 'string' ? body.name : '').trim();
    const birthDate = (typeof body.birthDate === 'string' ? body.birthDate : '').trim();
    const phone = (typeof body.phone === 'string' ? body.phone : '').replace(/[^0-9]/g, '');
    const normPhone = normalizePhone(phone);

    if (!name || !birthDate || !normPhone) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '이름·생년월일·연락처를 정확히 입력해 주세요.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('safety_pledges')
      .select('id, company_name, issued_at, expires_at')
      .eq('name', name)
      .eq('birth_date', birthDate)
      .eq('normalized_phone', normPhone)
      .is('signature', null)
      .gte('expires_at', nowIso)
      .order('issued_at', { ascending: false });

    if (error) {
      console.error('[safety-pledges/my-unsigned] error:', error);
      return NextResponse.json(
        { success: false, code: 'QUERY_FAILED', message: '조회 중 오류가 발생했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        items: (data ?? []).map((p: any) => ({
          pledgeId: p.id,
          companyName: p.company_name,
          issuedAt: p.issued_at,
          expiresAt: p.expires_at,
        })),
      },
    });
  } catch (e) {
    console.error('[safety-pledges/my-unsigned] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
