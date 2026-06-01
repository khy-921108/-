/**
 * 업체(company) 상수 — 코드와 라벨은 이 파일 한 곳에서만 관리.
 * UI 라벨 변경, 신규 구분 추가 시 이 파일만 수정.
 */

export type CompanyType =
  | 'GENERAL'
  | 'INDIVIDUAL'
  | 'TRANSPORT'
  | 'EQUIPMENT'
  | 'TEMP';

export type CompanyStatus = 'REVIEW' | 'ACTIVE' | 'DISABLED';

export type CompanyCreatedBy = 'APPLICANT' | 'ADMIN';

export interface CompanyTypeOption {
  code: CompanyType;
  label: string;
}

export interface CompanyStatusOption {
  code: CompanyStatus;
  label: string;
}

export const COMPANY_TYPES: CompanyTypeOption[] = [
  { code: 'GENERAL', label: '일반업체' },
  { code: 'INDIVIDUAL', label: '개인작업자' },
  { code: 'TRANSPORT', label: '운송업체' },
  { code: 'EQUIPMENT', label: '장비업체' },
  { code: 'TEMP', label: '임시업체' },
];

export const COMPANY_STATUS: CompanyStatusOption[] = [
  { code: 'REVIEW', label: '검토중' },
  { code: 'ACTIVE', label: '정식등록' },
  { code: 'DISABLED', label: '사용중지' },
];

const TYPE_LABEL_MAP: Record<CompanyType, string> = COMPANY_TYPES.reduce(
  (acc, t) => {
    acc[t.code] = t.label;
    return acc;
  },
  {} as Record<CompanyType, string>
);

const STATUS_LABEL_MAP: Record<CompanyStatus, string> = COMPANY_STATUS.reduce(
  (acc, s) => {
    acc[s.code] = s.label;
    return acc;
  },
  {} as Record<CompanyStatus, string>
);

export function companyTypeLabel(code: string | null | undefined): string {
  if (!code) return '-';
  return TYPE_LABEL_MAP[code as CompanyType] ?? code;
}

export function companyStatusLabel(code: string | null | undefined): string {
  if (!code) return '-';
  return STATUS_LABEL_MAP[code as CompanyStatus] ?? code;
}

export function isCompanyType(value: unknown): value is CompanyType {
  return (
    typeof value === 'string' && value in TYPE_LABEL_MAP
  );
}

export function isCompanyStatus(value: unknown): value is CompanyStatus {
  return (
    typeof value === 'string' && value in STATUS_LABEL_MAP
  );
}
