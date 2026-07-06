import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { DOC_BUCKET, pathBelongsToCompany } from '@/lib/company-documents';

export const runtime = 'nodejs';

/**
 * DELETE /api/admin/companies/:id/documents/:docId  (requireAdmin)
 * - Storage 파일 + 메타 행 둘 다 삭제.
 * - 문서가 그 업체 소속인지 검증(id + company_id, 경로 격리) → 타업체 삭제 차단.
 */
export async function DELETE(_req: Request, ctx: { params: { id: string; docId: string } }) {
  const auth = await requirePermission('COMPANIES_EDIT');
  if (!auth.ok) return auth.response;

  const { id: companyId, docId } = ctx.params;
  const supabase = createServiceClient();

  const { data: doc, error } = await supabase
    .from('company_documents')
    .select('id, company_id, storage_path')
    .eq('id', docId)
    .eq('company_id', companyId) // 소속 격리
    .maybeSingle();
  if (error) {
    console.error('[documents DELETE] query:', error);
    return NextResponse.json({ success: false, code: 'QUERY_FAILED', message: error.message }, { status: 500 });
  }
  if (!doc) {
    return NextResponse.json({ success: false, code: 'NOT_FOUND', message: '문서를 찾을 수 없습니다.' }, { status: 404 });
  }
  if (!pathBelongsToCompany(doc.storage_path, companyId)) {
    return NextResponse.json({ success: false, code: 'PATH_MISMATCH', message: '문서 경로가 업체와 일치하지 않습니다.' }, { status: 400 });
  }

  // 1) Storage 파일 삭제(없어도 메타 정리는 진행)
  const { error: rmErr } = await supabase.storage.from(DOC_BUCKET).remove([doc.storage_path]);
  if (rmErr) {
    // 파일이 이미 없을 수도 있음 — 로그만 남기고 메타는 정리
    console.error('[documents DELETE] storage remove (계속 진행):', rmErr);
  }

  // 2) 메타 행 삭제(소속 재확인)
  const { error: delErr } = await supabase
    .from('company_documents')
    .delete()
    .eq('id', docId)
    .eq('company_id', companyId);
  if (delErr) {
    console.error('[documents DELETE] meta delete:', delErr);
    return NextResponse.json({ success: false, code: 'DELETE_FAILED', message: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
