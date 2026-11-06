import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRealDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const fail = (code: string, message: string, status = 400) =>
  NextResponse.json({ success: false, code, message }, { status });

/**
 * PATCH /api/admin/sessions/:id — 수료 기록 수정 (권한 SESSION_DELETE)
 * Body: { name, birthDate, phone, vehicleNumber, companyId?, reason }
 * - 같은 사람의 세션과 같은 업체 명단을 함께 고친다. 서약·각서·허가서 참여자는 안 건드림.
 * - 처리·로그는 SQL 함수 admin_edit_training_record 한 트랜잭션.
 */
export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission('SESSION_DELETE');
  if (!auth.ok) return auth.response;
  if (!UUID_RE.test(ctx.params.id)) return fail('NOT_FOUND', '기록을 찾을 수 없습니다.', 404);

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const birthDate = typeof body.birthDate === 'string' ? body.birthDate.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.replace(/[^0-9]/g, '') : '';
  const vehicleNumber = typeof body.vehicleNumber === 'string' ? body.vehicleNumber.trim() : '';
  const companyId = typeof body.companyId === 'string' && body.companyId.trim() ? body.companyId.trim() : null;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  if (!reason) return fail('NO_REASON', '수정 사유를 입력해 주세요.');
  if (!name || name.length > 50) return fail('INVALID_INPUT', '이름을 확인해 주세요(50자 이내).');
  if (!isRealDate(birthDate)) return fail('INVALID_INPUT', '생년월일을 확인해 주세요.');
  if (phone.length < 10 || phone.length > 11) return fail('INVALID_INPUT', '연락처를 확인해 주세요.');
  if (vehicleNumber.length > 30) return fail('INVALID_INPUT', '차량번호가 너무 깁니다(30자 이내).');
  if (companyId && !UUID_RE.test(companyId)) return fail('INVALID_INPUT', '소속 업체가 올바르지 않습니다.');

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('admin_edit_training_record', {
    p_session_id: ctx.params.id,
    p_name: name,
    p_birth_date: birthDate,
    p_phone: phone,
    p_vehicle_number: vehicleNumber,
    p_company_id: companyId,
    p_reason: reason,
    p_actor: auth.admin.email,
  });

  if (error) {
    console.error('[admin/sessions PATCH]', error);
    return fail('UPDATE_FAILED', '수정하지 못했습니다. 바뀐 내용은 없습니다.', 500);
  }

  const r = data as any;
  if (!r?.ok) {
    if (r?.code === 'NOT_FOUND') return fail('NOT_FOUND', '기록을 찾을 수 없습니다.', 404);
    if (r?.code === 'NO_CHANGE') return fail('NO_CHANGE', '바뀐 내용이 없습니다.');
    if (r?.code === 'COMPANY_NOT_ALLOWED') return fail('COMPANY_NOT_ALLOWED', '사용중지된 업체는 선택할 수 없습니다.');
    return fail(r?.code ?? 'UPDATE_FAILED', '수정하지 못했습니다.');
  }

  const notices: string[] = [];
  if (r.personChanged) notices.push('다음 신청 때 개인 서약을 새로 받아야 합니다.');
  if (r.companyChanged) notices.push('이행각서 재발급이 필요할 수 있습니다.');
  if (r.membersMerged > 0) notices.push('업체 명단에 같은 사람이 이미 있어 중복 행을 정리했습니다.');

  return NextResponse.json({ success: true, data: { ...r, notices } });
}

/**
 * DELETE /api/admin/sessions/:id — 수료 기록 1건 삭제 (권한 SESSION_DELETE)
 * Body: { reason }
 * - 수료 유무와 상관없이 같은 흐름. 전체 내용을 로그에 저장한 뒤 삭제.
 * - 허가서 참여자로 쓰인 기록은 거부(수정만 가능). 업체 명단 행은 지우지 않음.
 */
export async function DELETE(req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission('SESSION_DELETE');
  if (!auth.ok) return auth.response;
  if (!UUID_RE.test(ctx.params.id)) return fail('NOT_FOUND', '기록을 찾을 수 없습니다.', 404);

  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return fail('NO_REASON', '삭제 사유를 입력해 주세요.');

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('admin_delete_training_record', {
    p_session_id: ctx.params.id,
    p_reason: reason,
    p_actor: auth.admin.email,
  });

  if (error) {
    console.error('[admin/sessions DELETE]', error);
    // 함수 잠금과 동시에 참여자가 붙은 경우 등 FK 거부
    if (error.code === '23503') {
      return fail('IN_USE', '작업허가서에 쓰인 기록은 삭제할 수 없습니다. 수정만 가능합니다.', 409);
    }
    return fail('DELETE_FAILED', '삭제하지 못했습니다. 바뀐 내용은 없습니다.', 500);
  }

  const r = data as any;
  if (!r?.ok) {
    if (r?.code === 'NOT_FOUND') return fail('NOT_FOUND', '기록을 찾을 수 없습니다.', 404);
    if (r?.code === 'IN_USE') {
      const permits: string[] = Array.isArray(r.permits) ? r.permits : [];
      return fail(
        'IN_USE',
        `작업허가서${permits.length ? `(${permits.join(', ')})` : ''}에 쓰인 기록은 삭제할 수 없습니다. 수정만 가능합니다.`,
        409
      );
    }
    return fail(r?.code ?? 'DELETE_FAILED', '삭제하지 못했습니다.');
  }

  return NextResponse.json({
    success: true,
    data: { deletedId: ctx.params.id, name: r.name, notices: ['업체 명단에서는 별도로 삭제하세요.'] },
  });
}
