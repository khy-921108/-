/**
 * ③ 업체별 문서함 — 상수·검증·경로 헬퍼.
 * - 저장소: Private 버킷 'company-documents'.
 * - 경로: {companyId}/{category}/{yyyyMMdd-HHmmss}-{원본파일명}.
 * - 카테고리는 고정(한글표시 ↔ 영문폴더키).
 * - 업로드 게이트: 확장자 화이트리스트(결정적) + 크기 ≤ 50MB.
 *   (브라우저 MIME 은 hwp 등에서 불안정해 확장자를 1차 기준으로 사용)
 */

export const DOC_BUCKET = 'company-documents';
export const MAX_DOC_BYTES = 50 * 1024 * 1024; // 50MB

export const DOC_CATEGORIES = [
  { key: 'roster', label: '인원명단' },
  { key: 'permits', label: '작업허가서' },
  { key: 'pledges', label: '서약서·이행각서' },
  { key: 'insurance', label: '보험·계약서' },
  { key: 'equipment', label: '장비서류' },
  { key: 'etc', label: '기타' },
] as const;

export type DocCategoryKey = (typeof DOC_CATEGORIES)[number]['key'];

const CATEGORY_KEYS = DOC_CATEGORIES.map((c) => c.key) as readonly string[];
const CATEGORY_LABEL = new Map<string, string>(DOC_CATEGORIES.map((c) => [c.key, c.label]));

export function isDocCategory(v: unknown): v is DocCategoryKey {
  return typeof v === 'string' && CATEGORY_KEYS.includes(v);
}
export function docCategoryLabel(key: string): string {
  return CATEGORY_LABEL.get(key) ?? key;
}

/** 허용 확장자(소문자). 그 외(exe 등)는 거부. */
export const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'xlsx', 'docx', 'hwp'] as const;

/** 참고용 MIME 화이트리스트(저장은 하되, 게이트는 확장자 기준). */
export const ALLOWED_MIME: Record<string, true> = {
  'application/pdf': true,
  'image/jpeg': true,
  'image/png': true,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': true,
  'application/x-hwp': true,
  'application/haansofthwp': true,
  'application/vnd.hancom.hwp': true,
  'application/octet-stream': true, // hwp/일부 브라우저 fallback
  '': true,
};

export function fileExtension(name: string): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/**
 * 파일명에서 경로/제어문자 제거(스토리지 키 안전화). 한글·괄호·점·대시·언더스코어·공백 유지.
 */
export function sanitizeFileName(name: string): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .replace(/[\x00-\x1f\x7f]/g, '') // 제어문자
    .replace(/[\\/:*?"<>|]/g, '_') // 파일시스템/스토리지 금지문자
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'file';
}

export interface UploadValidationInput {
  fileName: string;
  sizeBytes: number;
  mimeType?: string | null;
}
export type UploadValidation = { ok: true } | { ok: false; code: string; message: string };

export function validateUpload(input: UploadValidationInput): UploadValidation {
  const ext = fileExtension(input.fileName);
  if (!ext) {
    return { ok: false, code: 'NO_EXTENSION', message: '확장자가 없는 파일은 업로드할 수 없습니다.' };
  }
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      ok: false,
      code: 'EXT_NOT_ALLOWED',
      message: `허용되지 않는 파일 형식(.${ext})입니다. 허용: ${ALLOWED_EXTENSIONS.join(', ')}`,
    };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, code: 'EMPTY_FILE', message: '빈 파일입니다.' };
  }
  if (input.sizeBytes > MAX_DOC_BYTES) {
    const mb = (input.sizeBytes / (1024 * 1024)).toFixed(1);
    return { ok: false, code: 'TOO_LARGE', message: `파일 크기(${mb}MB)가 50MB 를 초과합니다.` };
  }
  return { ok: true };
}

/** KST 기준 yyyyMMdd-HHmmss 스탬프(서버 UTC → +9h 수동). */
export function kstStamp(nowMs: number): string {
  const k = new Date(nowMs + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}-${p(k.getUTCHours())}${p(k.getUTCMinutes())}${p(k.getUTCSeconds())}`;
}

/** 스토리지 경로 빌더 — {companyId}/{category}/{stamp}-{safeName} */
export function buildStoragePath(companyId: string, category: string, fileName: string, nowMs: number): string {
  return `${companyId}/${category}/${kstStamp(nowMs)}-${sanitizeFileName(fileName)}`;
}

/** 경로가 해당 업체 소속인지(타업체 격리 핵심). 상위탈출(..)·역슬래시는 거부. */
export function pathBelongsToCompany(storagePath: string, companyId: string): boolean {
  if (typeof storagePath !== 'string') return false;
  if (storagePath.includes('..') || storagePath.includes('\\')) return false;
  return storagePath.startsWith(`${companyId}/`);
}

/** Supabase 에러 메시지로 '버킷 없음' 판별. */
export function isBucketMissing(error: { message?: string } | null | undefined): boolean {
  const m = (error?.message ?? '').toLowerCase();
  return m.includes('bucket not found') || m.includes('not found') && m.includes('bucket');
}
