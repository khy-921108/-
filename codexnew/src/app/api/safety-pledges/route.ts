import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/equipment';
import { sixMonthsLater } from '@/lib/safety-doc-status';

/**
 * POST /api/safety-pledges  (공개) — 개인 안전준수 서약(#8) 발급
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = (typeof body.name === 'string' ? body.name : '').trim();
    const birthDate = (typeof body.birthDate === 'string' ? body.birthDate : '').trim();
    const phone = (typeof body.phone === 'string' ? body.phone : '').replace(/[^0-9]/g, '');
    const companyId =
      typeof body.companyId === 'string' && body.companyId.trim() ? body.companyId.trim() : null;
    const nationality = (typeof body.nationality === 'string' ? body.nationality : '').trim() || null;
    const bloodType = (typeof body.bloodType === 'string' ? body.bloodType : '').trim() || null;
    const jobType = (typeof body.jobType === 'string' ? body.jobType : '').trim() || null;
    // 디지털 서명(PNG data URL). 과대 입력 방지 300KB 한도.
    let signature: string | null = typeof body.signature === 'string' ? body.signature : null;
    if (signature && (!signature.startsWith('data:image/') || signature.length > 300_000)) {
      signature = null;
    }

    if (!name || !birthDate || phone.length < 10) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '이름·생년월일·연락처를 정확히 입력해 주세요.' },
        { status: 400 }
      );
    }
    if (!nationality || !bloodType || !jobType) {
      return NextResponse.json(
        { success: false, code: 'INVALID_INPUT', message: '국적·혈액형·직종을 모두 입력해 주세요.' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    let companyName: string | null = null;
    if (companyId) {
      const { data: c } = await supabase.from('companies').select('name').eq('id', companyId).maybeSingle();
      companyName = c?.name ?? null;
    }

    const { issuedAt, expiresAt } = sixMonthsLater();

    const { data, error } = await supabase
      .from('safety_pledges')
      .insert({
        name,
        birth_date: birthDate,
        phone,
        normalized_phone: normalizePhone(phone),
        company_id: companyId,
        company_name: companyName,
        nationality,
        blood_type: bloodType,
        job_type: jobType,
        signature,
        issued_at: issuedAt,
        expires_at: expiresAt,
      })
      .select('id, expires_at')
      .single();

    if (error || !data) {
      console.error('[safety-pledges POST] error:', error);
      return NextResponse.json(
        { success: false, code: 'SAVE_FAILED', message: '서약서 발급에 실패했습니다.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { pledgeId: data.id, expiresAt: data.expires_at },
    });
  } catch (e) {
    console.error('[safety-pledges POST] unexpected:', e);
    return NextResponse.json(
      { success: false, code: 'SERVER_ERROR', message: '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
