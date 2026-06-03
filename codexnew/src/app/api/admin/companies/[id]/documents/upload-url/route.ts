import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import {
  DOC_BUCKET,
  buildStoragePath,
  isBucketMissing,
  isDocCategory,
  validateUpload,
} from '@/lib/company-documents';

export const runtime = 'nodejs';

/**
 * POST /api/admin/companies/:id/documents/upload-url  (requireAdmin)
 * - 검증(카테고리·확장자·50MB) 통과 시 그 업체 경로에 대한 signed upload URL 발급.
 * - 브라우저가 이 URL 로 Storage 에 직접 PUT(서버 본문 미경유 → 대용량 가능).
 * req: { fileName, category, sizeBytes, mimeType }
 * res: { success, data:{ signedUrl, token, path, fileName, category } }
 */
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const companyId = ctx.params.id;
  const supabase = createServiceClient();

  // 업체 존재 확인(경로 격리 기준)
  const { data: company, error: cErr } = await supabase
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .maybeSingle();
  if (cErr) {
    console.error('[documents/upload-url] company:', cErr);
    return NextResponse.json({ success: false, code: 'QUERY_FAILED', message: cErr.message }, { status: 500 });
  }
  if (!company) {
    return NextResponse.json({ success: false, code: 'NOT_FOUND', message: '업체를 찾을 수 없습니다.' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const category = typeof body.category === 'string' ? body.category : '';
  const sizeBytes = Number(body.sizeBytes);
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';

  if (!fileName) {
    return NextResponse.json({ success: false, code: 'INVALID_INPUT', message: '파일명이 없습니다.' }, { status: 400 });
  }
  if (!isDocCategory(category)) {
    return NextResponse.json({ success: false, code: 'INVALID_CATEGORY', message: '문서 분류가 올바르지 않습니다.' }, { status: 400 });
  }
  const v = validateUpload({ fileName, sizeBytes, mimeType });
  if (!v.ok) {
    return NextResponse.json({ success: false, code: v.code, message: v.message }, { status: 400 });
  }

  const path = buildStoragePath(companyId, category, fileName, Date.now());

  const { data, error } = await supabase.storage.from(DOC_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    if (isBucketMissing(error)) {
      return NextResponse.json(
        {
          success: false,
          code: 'BUCKET_MISSING',
          message: `저장소 버킷('${DOC_BUCKET}')이 없습니다. Supabase 대시보드 → Storage 에서 Private 버킷으로 먼저 생성해 주세요.`,
        },
        { status: 503 }
      );
    }
    console.error('[documents/upload-url] signed url:', error);
    return NextResponse.json({ success: false, code: 'SIGN_FAILED', message: '업로드 URL 발급에 실패했습니다.' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: { signedUrl: data.signedUrl, token: data.token, path: data.path ?? path, fileName, category },
  });
}
