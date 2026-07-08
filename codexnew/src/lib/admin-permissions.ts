/**
 * 1D-1 어드민 권한키 정의 (API·화면 공용).
 * - group: 'default'(생성 시 ON·회수가능) / 'optional'(생성 시 OFF) / 'super'(SUPER 전용·부여불가)
 * - SUPER 는 모든 권한 통과(권한키 무시). ADMIN 은 permissions 배열에 있는 key 만.
 */

export type AdminRole = 'SUPER' | 'ADMIN';

export interface PermissionDef {
  key: string;
  label: string;
  group: 'default' | 'optional' | 'super';
}

export const ADMIN_PERMISSIONS: PermissionDef[] = [
  // 기본 부여(생성 시 ON, 회수 가능)
  { key: 'COMPLETIONS_VIEW', label: '수료 현황 조회', group: 'default' },
  { key: 'WORKPERMITS_VIEW', label: '작업허가 조회', group: 'default' },
  { key: 'COMPANIES_VIEW', label: '업체 조회', group: 'default' },
  { key: 'EXCEL_EXPORT', label: '엑셀 다운로드', group: 'default' },
  // 선택 부여(생성 시 OFF)
  { key: 'WORKPERMITS_APPROVE', label: '작업허가 승인·서명(발급/입회)', group: 'optional' },
  { key: 'COMPANIES_EDIT', label: '업체 추가·수정·인원·문서', group: 'optional' },
  { key: 'COMPANIES_MANAGE', label: '업체 상태·삭제·병합', group: 'optional' },
  { key: 'SESSION_DELETE', label: '수료(세션) 삭제', group: 'optional' },
  { key: 'EXCEL_IMPORT', label: '엑셀 업로드(반영)', group: 'optional' },
  { key: 'QUESTIONS_MANAGE', label: '시험문제 관리', group: 'optional' },
  { key: 'COURSES_MANAGE', label: '교육과정·영상 관리', group: 'optional' },
  // SUPER 전용(ADMIN 에게 부여 불가)
  { key: 'APP_SETTINGS', label: '운영 설정', group: 'super' },
  { key: 'ADMINS_MANAGE', label: '관리자 관리', group: 'super' },
];

export type PermissionKey = (typeof ADMIN_PERMISSIONS)[number]['key'];

const BY_KEY = new Map(ADMIN_PERMISSIONS.map((p) => [p.key, p]));

export const DEFAULT_PERMISSIONS: string[] = ADMIN_PERMISSIONS.filter((p) => p.group === 'default').map((p) => p.key);
export const OPTIONAL_PERMISSIONS: string[] = ADMIN_PERMISSIONS.filter((p) => p.group === 'optional').map((p) => p.key);
/** ADMIN 에게 부여 가능한 권한(기본+선택) — SUPER 전용 제외 */
export const GRANTABLE_PERMISSIONS: string[] = ADMIN_PERMISSIONS.filter((p) => p.group !== 'super').map((p) => p.key);

export function permissionLabel(key: string): string {
  return BY_KEY.get(key)?.label ?? key;
}
export function isGrantablePermission(key: unknown): key is string {
  return typeof key === 'string' && GRANTABLE_PERMISSIONS.includes(key);
}
/** 입력 배열에서 부여 가능한 권한만 남김(SUPER전용·미지정·중복 제거) */
export function sanitizePermissions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>();
  for (const k of input) {
    if (isGrantablePermission(k)) set.add(k);
  }
  return Array.from(set);
}
