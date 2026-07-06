import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/supabase/auth';
import {
  docCategoryLabel,
  isDocCategory,
  pathBelongsToCompany,
} from '@/lib/company-documents';

export const runtime = 'nodejs';

/**
 * GET /api/admin/companies/:id/documents?category=...  (requireAdmin)
 * - 그 업체 문서 메타 목록(최신순). category 지정 시 해당 분류만.
 * - 업체 범위만(타업체 문서 미노출).
 */
export async function GET(req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission('COMPANIES_VIEW');
  if (!auth.ok) return auth.response;

  const companyId = ctx.params.id;
  const url = new URL(req.url);
  const category = (url.searchParams.get('category') ?? '').trim();

  const supabase = createServiceClient();
  let q = supabase
    .from('company_documents')
    .select('id, category, file_name, mime_type, size_bytes, note, uploaded_by, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (category && isDocCategory(category)) {
    q = q.eq('category', category);
  }

  const { data, error } = await q;
  if (error) {
    console.error('[documents GET] error:', error);
    return NextResponse.json({ success: false, code: 'QUERY_FAILED', message: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      items: (data ?? []).map((d: any) => ({
        id: d.id,
        category: d.category,
        categoryLabel: docCategoryLabel(d.category),
        fileName: d.file_name,
        mimeType: d.mime_type,
        sizeBytes: d.size_bytes,
        note: d.note,
        uploadedBy: d.uploaded_by,
        createdAt: d.created_at,
      })),
    },
  });
}

/**
 * POST /api/admin/companies/:id/documents  (requireAdmin)
 * - Storage 업로드 완료 후 메타(company_documents) 기록.
 * - storagePath 가 이 업체 경로({companyId}/...)인지 검증(타업체 경로 주입 차단).
 * req: { category, fileName, storagePath, mimeType, sizeBytes, note? }
 */
export async function POST(req: Request, ctx: { params: { id: string } }) {
  const auth = await requirePermission('COMPANIES_EDIT');
  if (!auth.ok) return auth.response;

  const companyId = ctx.params.id;
  const supabase = createServiceClient();

  const { data: company, error: cErr } = await supabase
    .from('companies')
    .select('id')
    .eq('id', companyId)
    .maybeSingle();
  if (cErr) {
    console.error('[documents POST] company:', cErr);
    return NextResponse.json({ success: false, code: 'QUERY_FAILED', message: cErr.message }, { status: 500 });
  }
  if (!company) {
    return NextResponse.json({ success: false, code: 'NOT_FOUND', message: '업체를 찾을 수 없습니다.' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const category = typeof body.category === 'string' ? body.category : '';
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const storagePath = typeof body.storagePath === 'string' ? body.storagePath : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : null;
  const sizeBytes = Number.isFinite(Number(body.sizeBytes)) ? Number(body.sizeBytes) : null;
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

  if (!isDocCategory(category)) {
    return NextResponse.json({ success: false, code: 'INVALID_CATEGORY', message: '문서 분류가 올바르지 않습니다.' }, { status: 400 });
  }
  if (!fileName || !storagePath) {
    return NextResponse.json({ success: false, code: 'INVALID_INPUT', message: '파일 정보가 부족합니다.' }, { status: 400 });
  }
  // 타업체 경로 주입 차단 — 경로는 반드시 이 업체 폴더 하위
  if (!pathBelongsToCompany(storagePath, companyId)) {
    return NextResponse.json({ success: false, code: 'PATH_MISMATCH', message: '문서 경로가 업체와 일치하지 않습니다.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('company_documents')
    .insert({
      company_id: companyId,
      category,
      file_name: fileName,
      storage_path: storagePath,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      note,
      uploaded_by: auth.user.email ?? null,
    })
    .select('id, created_at')
    .single();

  if (error || !data) {
    console.error('[documents POST] insert:', error);
    return NextResponse.json({ success: false, code: 'SAVE_FAILED', message: error?.message ?? '저장 실패' }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { id: data.id, createdAt: data.created_at } });
}
