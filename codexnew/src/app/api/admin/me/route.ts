import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * GET /api/admin/me  (requireAdmin)
 * - 현재 로그인 관리자의 역할·권한 + 등록 서명 프로필(부서·이름·직책·서명) 반환.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = auth.admin;

  return NextResponse.json({
    success: true,
    data: {
      email: a.email,
      role: a.role,
      permissions: a.role === 'SUPER' ? ['*'] : a.permissions,
      department: a.department,
      displayName: a.displayName,
      title: a.title,
      signature: a.signature, // 등록 서명(1클릭 자동채움용)
    },
  });
}

/**
 * PATCH /api/admin/me  (requireAdmin) — 본인 서명 프로필 저장(부서·이름·직책·서명).
 * 본인 레코드만 수정. 서명은 PNG data URL(선택).
 */
export async function PATCH(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, code: 'BAD_REQUEST', message: '잘못된 요청입니다.' }, { status: 400 });
  }

  const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const update: Record<string, any> = {
    department: clip(body?.department, 50) || null,
    display_name: clip(body?.displayName, 50) || null,
    title: clip(body?.title, 50) || null,
  };
  // signature: data URL → 갱신 / null → 삭제 / undefined·'' → 변경 안 함 / 그 외 문자열 → 오류
  const sig = body?.signature;
  if (typeof sig === 'string' && sig.startsWith('data:image/')) update.signature = sig;
  else if (sig === null) update.signature = null;
  else if (typeof sig === 'string' && sig !== '') {
    return NextResponse.json({ success: false, code: 'BAD_SIGNATURE', message: '서명 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from('admins').update(update).eq('email', auth.admin.email);
  if (error) {
    console.error('[admin/me PATCH] update:', error);
    return NextResponse.json({ success: false, code: 'UPDATE_FAILED', message: '저장 실패' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
