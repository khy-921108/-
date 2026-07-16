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
  { code: 'TEMP', label: '기타(방문·점검)' }, // DB 값 TEMP 유지, 라벨만 변경(관공서 점검·A/S 방문·견학 등)
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

// ===== 구분별 요구 수준 (등록·수정·엑셀·승인 전부 이 규칙 하나로) =====
//  · 일반·장비: 업체명 필수 / 담당자명·연락처 필수 / 사업자번호·주소·대표번호 = 등록 권장, 승인(정식등록) 시 필수
//  · 운송·기타(방문·점검): 업체명만 필수
//  · 개인작업자: 업체명 = "개인(이름)" 자동 생성, 담당자 없음(본인), 사업자번호 선택(입력 시 검증)

export interface CompanyFieldRules {
  managerRequired: boolean;      // 담당자명·연락처 필수(등록 시)
  approvalNeedsBiz: boolean;     // 승인(정식등록) 시 사업자번호·주소·대표번호 필수
  showManager: boolean;          // 폼에 담당자 칸 표시
  showBizFields: boolean;        // 폼에 사업자번호·주소·대표번호 칸 표시
  isIndividual: boolean;         // 개인작업자(업체명 자동)
}

export function companyFieldRules(type: CompanyType): CompanyFieldRules {
  switch (type) {
    case 'GENERAL':
    case 'EQUIPMENT':
      return { managerRequired: true, approvalNeedsBiz: true, showManager: true, showBizFields: true, isIndividual: false };
    case 'INDIVIDUAL':
      return { managerRequired: false, approvalNeedsBiz: false, showManager: false, showBizFields: true, isIndividual: true };
    case 'TRANSPORT':
    case 'TEMP':
    default:
      return { managerRequired: false, approvalNeedsBiz: false, showManager: true, showBizFields: false, isIndividual: false };
  }
}

/** 승인(정식등록) 시 부족한 필수 항목 목록. 비어 있으면 승인 가능. */
export function approvalMissingFields(c: {
  company_type: string; biz_no?: string | null; address?: string | null; tel?: string | null;
}): string[] {
  const rules = companyFieldRules(c.company_type as CompanyType);
  if (!rules.approvalNeedsBiz) return [];
  const missing: string[] = [];
  if (!(c.biz_no ?? '').trim()) missing.push('사업자번호');
  if (!(c.address ?? '').trim()) missing.push('사업장 주소');
  if (!(c.tel ?? '').trim()) missing.push('대표번호');
  return missing;
}

/**
 * 구분별 등록/수정 입력 검증(3개 문 공통 — 공개 등록·관리자·엑셀).
 * 반환 = 오류 메시지 목록(빈 배열 = 통과). 체크섬 검사는 호출부가 isValidBizNo 로.
 */
export function validateCompanyInput(input: {
  companyType: CompanyType;
  name: string;
  managerName?: string | null;
  phone?: string | null;
  targetStatus?: string | null; // 'ACTIVE' 로 저장하려는 경우 승인 필수 검사
  bizNo?: string | null;
  address?: string | null;
  tel?: string | null;
}): string[] {
  const errors: string[] = [];
  const rules = companyFieldRules(input.companyType);
  if (!input.name.trim()) errors.push('업체명을 입력해 주세요.');
  if (rules.managerRequired) {
    if (!(input.managerName ?? '').trim()) errors.push('담당자명을 입력해 주세요.');
    if (!(input.phone ?? '').trim()) errors.push('담당자 연락처를 입력해 주세요.');
  }
  if (input.targetStatus === 'ACTIVE') {
    const missing = approvalMissingFields({
      company_type: input.companyType, biz_no: input.bizNo, address: input.address, tel: input.tel,
    });
    if (missing.length > 0) errors.push(`정식등록에는 ${missing.join('·')}이(가) 필요합니다. 업체에 확인 후 입력하세요.`);
  }
  return errors;
}
