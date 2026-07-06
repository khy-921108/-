/**
 * src/app/api/_debug/aligo-test/route.ts — 알리고 발송 검증용 임시 라우트 (R-5 0단계)
 * ⚠️ 임시: R-5 완료 시 이 파일과 /admin/sms-test 페이지를 삭제할 것.
 * SUPER 관리자만 호출 가능(과금/남용 방지).
 */

import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/supabase/auth';
import { sendSms, isAligoConfigured } from '@/lib/aligo';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  if (!isAligoConfigured()) {
    return NextResponse.json(
      { success: false, message: 'ALIGO 환경변수 미설정 (ALIGO_USER_ID / ALIGO_API_KEY / ALIGO_SENDER)' },
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
    aligoMessage: r.message,
    raw: r.raw,
  });
}
