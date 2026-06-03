import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { DOC_BUCKET, isBucketMissing, pathBelongsToCompany } from '@/lib/company-documents';

export const runtime = 'nodejs';

/**
 * GET /api/admin/companies/:id/documents/:docId/download  (requireAdmin)
 * - 단기(60초) signed download URL 발급. 원본 파일명으로 저장되게 download 옵션 부여.
 * - 문서가 그 업체 소속인지 검증(id + company_id 동시 매칭, 경로 격리) → 타업체 다운로드 차단.
 */
export async function GET(_req: Request, ctx: { params: { id: string; docId: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id: companyId, docId } = ctx.params;
  const supabase = createServiceClient();

  const { data: doc, error } = await supabase
    .from('company_documents')
    .select('id, company_id, storage_path, file_name')
    .eq('id', docId)
    .eq('company_id', companyId) // 소속 격리(타업체 문서 접근 차단)
    .maybeSingle();
  if (error) {
    console.error('[documents/download] query:', error);
    return NextResponse.json({ success: false, code: 'QUERY_FAILED', message: error.message }, { status: 500 });
  }
  if (!doc) {
    return NextResponse.json({ success: false, code: 'NOT_FOUND', message: '문서를 찾을 수 없습니다.' }, { status: 404 });
  }
  // 메타 company_id ↔ 경로 companyId 이중 검증
  if (!pathBelongsToCompany(doc.storage_path, companyId)) {
    return NextResponse.json({ success: false, code: 'PATH_MISMATCH', message: '문서 경로가 업체와 일치하지 않습니다.' }, { status: 400 });
  }

  const { data: signed, error: sErr } = await supabase.storage
    .from(DOC_BUCKET)
    .createSignedUrl(doc.storage_path, 60, { download: doc.file_name });
  if (sErr || !signed) {
    if (isBucketMissing(sErr)) {
      return NextResponse.json(
        { success: false, code: 'BUCKET_MISSING', message: `저장소 버킷('${DOC_BUCKET}')이 없습니다.` },
        { status: 503 }
      );
    }
    console.error('[documents/download] signed:', sErr);
    return NextResponse.json({ success: false, code: 'SIGN_FAILED', message: '다운로드 URL 발급에 실패했습니다.' }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { url: signed.signedUrl, fileName: doc.file_name } });
}
