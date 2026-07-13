import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { sanitizePermissions } from '@/lib/admin-permissions';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export const runtime = 'nodejs';

/**
 * GET /api/admin/admins  (requireSuperAdmin) — 관리자 목록
 */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('admins')
    .select('id, email, role, permissions, is_active, created_by, created_at, display_name, title, department')
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) {
    console.error('[admins GET] error:', error);
    return NextResponse.json({ success: false, code: 'QUERY_FAILED', message: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      items: (data ?? []).map((a: any) => ({
        id: a.id,
        email: a.email,
        role: a.role,
        permissions: Array.isArray(a.permissions) ? a.permissions : [],
        isActive: a.is_active,
        createdBy: a.created_by,
        createdAt: a.created_at,
        displayName: a.display_name ?? '',
        title: a.title ?? '',
        department: a.department ?? '',
      })),
    },
  });
}

/**
 * POST /api/admin/admins  (requireSuperAdmin) — 새 ADMIN 계정 생성
 * req: { email, password, permissions[] }
 * - role 은 항상 'ADMIN' 강제(SUPER 로 생성 불가).
 * - permissions 는 부여 가능(기본+선택)만 반영(SUPER 전용 제거).
 * - Supabase Auth 계정 생성(email_confirm) + admins INSERT.
 * - 비밀번호는 응답에 1회만 반환.
 */
export async function POST(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const permissions = sanitizePermissions(body.permissions);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ success: false, code: 'INVALID_EMAIL', message: '이메일 형식이 올바르지 않습니다.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ success: false, code: 'WEAK_PASSWORD', message: '초기 비밀번호는 8자 이상이어야 합니다.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // 이미 admins 에 있으면 거부
  const { data: existing } = await supabase.from('admins').select('id').eq('email', email).maybeSingle();
  if (existing) {
    return NextResponse.json({ success: false, code: 'ALREADY_EXISTS', message: '이미 등록된 관리자 이메일입니다.' }, { status: 409 });
  }

  // Supabase Auth 계정 생성(service_role)
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created?.user) {
    console.error('[admins POST] createUser:', createErr);
    return NextResponse.json(
      { success: false, code: 'AUTH_CREATE_FAILED', message: createErr?.message ?? '계정 생성에 실패했습니다. (이미 가입된 이메일일 수 있음)' },
      { status: 400 }
    );
  }

  // admins INSERT — role 은 ADMIN 강제
  const { data: adminRow, error: insErr } = await supabase
    .from('admins')
    .insert({
      auth_user_id: created.user.id,
      email,
      role: 'ADMIN',
      permissions,
      is_active: true,
      created_by: auth.admin.email,
    })
    .select('id, email, role, permissions, is_active')
    .single();

  if (insErr || !adminRow) {
    console.error('[admins POST] insert:', insErr);
    // 보상: 방금 만든 auth 계정 정리 시도(베스트에포트)
    try { await supabase.auth.admin.deleteUser(created.user.id); } catch { /* */ }
    return NextResponse.json({ success: false, code: 'SAVE_FAILED', message: insErr?.message ?? '관리자 저장 실패' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      id: adminRow.id,
      email: adminRow.email,
      role: adminRow.role,
      permissions: adminRow.permissions,
      isActive: adminRow.is_active,
      initialPassword: password, // 1회 표시
    },
    message: '관리자를 생성했습니다. 초기 비밀번호를 본인에게 전달하세요(이 화면을 닫으면 다시 볼 수 없습니다).',
  });
}
