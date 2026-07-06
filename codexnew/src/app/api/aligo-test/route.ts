/**
 * src/app/api/aligo-test/route.ts — SMS 발송 검증용 임시 라우트 (R-5 0단계)
 * (경로명은 aligo-test 그대로 두지만 내부는 솔라피 사용 — R-5 완료 시 이 파일과
 *  /admin/sms-test 페이지를 삭제할 것)
 * SUPER 관리자만 호출 가능(과금/남용 방지).
 */

import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/supabase/auth';
import { sendSms, isSmsConfigured } from '@/lib/sms';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  if (!isSmsConfigured()) {
    return NextResponse.json(
      { success: false, message: 'SOLAPI 환경변수 미설정 (SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_SENDER)' },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const to = typeof body.to === 'string' ? body.to : '';
  if (!to.trim()) {
    return NextResponse.json({ success: false, message: '수신 휴대폰 번호를 입력하세요.' }, { status: 400 });
  }

  const r = await sendSms(to, '[동남] 문자 발송 테스트입니다. (R-5 검증)');
  return NextResponse.json({
    success: r.ok,
    code: r.code,
    aligoMessage: r.message, // sms-test 페이지 호환 필드명 유지
    raw: r.raw,
  });
}
