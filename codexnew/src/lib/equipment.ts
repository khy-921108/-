/**
 * 장비/인원 구분 상수 — 코드와 라벨은 이 파일에서만 관리.
 * 신규 장비종류 추가 시 EQUIPMENT_TYPES 만 수정.
 */

export type EquipmentType =
  | 'EXCAVATOR'
  | 'FORKLIFT'
  | 'LADDER'
  | 'CRANE'
  | 'ETC';

export type MemberType = 'WORKER' | 'TRUCK' | 'HEAVY';

export interface EquipmentTypeOption {
  code: EquipmentType;
  label: string;
}

export interface MemberTypeOption {
  code: MemberType;
  label: string;
}

export const EQUIPMENT_TYPES: EquipmentTypeOption[] = [
  { code: 'EXCAVATOR', label: '포크레인' },
  { code: 'FORKLIFT', label: '지게차' },
  { code: 'LADDER', label: '사다리차' },
  { code: 'CRANE', label: '크레인' },
  { code: 'ETC', label: '기타' },
];

export const MEMBER_TYPES: MemberTypeOption[] = [
  { code: 'WORKER', label: '작업자' },
  { code: 'TRUCK', label: '화물차' },
  { code: 'HEAVY', label: '중장비' },
];

const EQUIPMENT_LABEL_MAP: Record<EquipmentType, string> = EQUIPMENT_TYPES.reduce(
  (acc, t) => {
    acc[t.code] = t.label;
    return acc;
  },
  {} as Record<EquipmentType, string>
);

const MEMBER_LABEL_MAP: Record<MemberType, string> = MEMBER_TYPES.reduce(
  (acc, t) => {
    acc[t.code] = t.label;
    return acc;
  },
  {} as Record<MemberType, string>
);

export function equipmentTypeLabel(code: string | null | undefined): string {
  if (!code) return '-';
  return EQUIPMENT_LABEL_MAP[code as EquipmentType] ?? code;
}

export function memberTypeLabel(code: string | null | undefined): string {
  if (!code) return '-';
  return MEMBER_LABEL_MAP[code as MemberType] ?? code;
}

export function isEquipmentType(value: unknown): value is EquipmentType {
  return typeof value === 'string' && value in EQUIPMENT_LABEL_MAP;
}

export function isMemberType(value: unknown): value is MemberType {
  return typeof value === 'string' && value in MEMBER_LABEL_MAP;
}

/**
 * 입력 전화번호에서 숫자만 추출 (company_members.normalized_phone 용).
 * - 빈 문자열/공백만 있을 경우 null 반환 → DB NULL 보존.
 */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[^0-9]/g, '');
  return digits.length === 0 ? null : digits;
}
