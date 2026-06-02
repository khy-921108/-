import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/equipment';

/**
 * POST /api/safety-pledges/sign  (공개) — 셀프서명: 본인 미서명 유효 서약에 서명 저장
 * req: { name, birthDate, phone, signature(PNG data URL) }
 * - 본인키(name+birth_date+normalized_phone) 매칭 + signature NULL + 미만료 서약에만 저장.
 * - 타인 서약 서명 금지(키 매칭이 곧 본인확인). 한 번 서명하면 6개월 재사용.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = (typeof body.name === 'string' ? body.name : '').trim();
    const birthDate = (typeof body.birthDate === 'string' ? body.birthDate : '').trim();
    const phone = (typeof body.phone === 'string' ? body.phone : '').replace(/[^0-9]/g, '');
    const normPhone = normalizePhone(phone);
    const signature = typeof body.signature === 'string' ? body.signature : '';

    if (!name || !birthDate || !normPhone) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '이름·생년월일·연락처를 정확히 입력해 주세요.' },
        { status: 400 }
      );
    }
    if (!signature.startsWith('data:image/') || signature.length > 300_000) {
      return NextResponse.json(
        { success: false, code: 'INVALID_SIGNATURE', message: '서명을 입력해 주세요.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const nowIso = new Date().toISOString();

    // 본인 미서명 유효 서약에만 서명 저장
    const { data, error } = await supabase
      .from('safety_pledges')
      .update({ signature })
      .eq('name', name)
      .eq('birth_date', birthDate)
      .eq('normalized_phone', normPhone)
      .is('signature', null)
      .gte('expires_at', nowIso)
      .select('id');

    if (error) {
      console.error('[safety-pledges/sign] error:', error);
      return NextResponse.json(
        { success: false, code: 'SAVE_FAILED', message: '서명 저장에 실패했습니다.' },
        { status: 500 }
      );
    }

    const count = (data ?? []).length;
    if (count === 0) {
      return NextResponse.json(
        { success: false, code: 'NOTHING_TO_SIGN', message: '서명할 미서명 서약이 없습니다. (이미 완료되었거나 발급 내역이 없습니다)' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: { signedCount: count } });
  } catch (e) {
    console.error('[safety-pledges/sign] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
