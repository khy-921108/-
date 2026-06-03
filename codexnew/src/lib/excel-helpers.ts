/**
 * ExcelJS 서버 전용 헬퍼.
 * - 클라이언트 코드에서 import 금지 (xlsx 파싱은 항상 서버에서).
 * - 두 시트 구조: "업체" + "인원".
 */

import ExcelJS from 'exceljs';
import {
  COMPANY_TYPES,
  COMPANY_STATUS,
  companyStatusLabel,
  companyTypeLabel,
  isCompanyStatus,
  isCompanyType,
  type CompanyStatus,
  type CompanyType,
} from './company';
import {
  EQUIPMENT_TYPES,
  MEMBER_TYPES,
  equipmentTypeLabel,
  isEquipmentType,
  isMemberType,
  memberTypeLabel,
  normalizePhone,
  type EquipmentType,
  type MemberType,
} from './equipment';

// ===== 시트/컬럼 정의 =====

export const COMPANY_SHEET_NAME = '업체';
export const MEMBER_SHEET_NAME = '인원';

export const COMPANY_HEADERS = [
  '업체명',
  '사업자번호',
  '업체구분',
  '담당자',
  '연락처',
  '상태',
  '비고',
] as const;

export const MEMBER_HEADERS = [
  '구분',
  '업체명',
  '이름',
  '생년월일',
  '연락처',
  '차량번호',
  '장비종류',
  '기타장비명',
  '톤수규격',
  '비고',
] as const;

// ===== 라벨 ↔ 코드 매핑 (엑셀은 사람이 읽는 라벨만 사용) =====

const COMPANY_TYPE_BY_LABEL = new Map<string, CompanyType>(
  COMPANY_TYPES.map((t) => [t.label, t.code])
);
const COMPANY_STATUS_BY_LABEL = new Map<string, CompanyStatus>(
  COMPANY_STATUS.map((s) => [s.label, s.code])
);
const MEMBER_TYPE_BY_LABEL = new Map<string, MemberType>(
  MEMBER_TYPES.map((m) => [m.label, m.code])
);
const EQUIPMENT_TYPE_BY_LABEL = new Map<string, EquipmentType>(
  EQUIPMENT_TYPES.map((e) => [e.label, e.code])
);

// ===== 입력 행 타입 =====

export interface CompanyRowInput {
  rowIndex: number; // 엑셀의 실제 행 번호 (헤더 = 1)
  name: string;
  bizNo: string | null;
  companyType: CompanyType;
  managerName: string | null;
  phone: string | null;
  status: CompanyStatus;
  note: string | null;
}

export interface MemberRowInput {
  rowIndex: number;
  memberType: MemberType;
  companyName: string;
  name: string;
  birthDate: string | null; // YYYY-MM-DD
  phone: string | null;
  normalizedPhone: string | null;
  vehicleNumber: string | null;
  equipmentType: EquipmentType | null;
  equipmentTypeEtc: string | null;
  spec: string | null;
  note: string | null;
}

export interface ParseError {
  sheet: string;
  rowIndex: number;
  field?: string;
  message: string;
}

export interface ParseWarning {
  sheet: string;
  rowIndex: number;
  message: string;
}

// ===== 유틸 =====

function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return '';
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'object' && v !== null) {
    const obj = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (typeof obj.text === 'string') return obj.text.trim();
    if (Array.isArray(obj.richText)) return obj.richText.map((p) => p.text).join('').trim();
    if (obj.result != null) return String(obj.result).trim();
  }
  return String(v).trim();
}

function normalizeDate(s: string): string | null {
  if (!s) return null;
  // 허용 포맷: YYYY-MM-DD, YYYY/MM/DD, YYYYMMDD
  const cleaned = s.trim();
  let m = cleaned.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) m = cleaned.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function validateHeader(actual: ExcelJS.Row | undefined, expected: readonly string[], sheet: string): ParseError[] {
  const errors: ParseError[] = [];
  if (!actual) {
    errors.push({ sheet, rowIndex: 1, message: '헤더 행이 없습니다.' });
    return errors;
  }
  expected.forEach((label, i) => {
    const cell = actual.getCell(i + 1);
    const value = cellText(cell);
    if (value !== label) {
      errors.push({
        sheet,
        rowIndex: 1,
        field: label,
        message: `${i + 1}번째 컬럼 헤더가 "${label}" 이어야 합니다 (현재: "${value || '비어있음'}").`,
      });
    }
  });
  return errors;
}

// ===== 워크북 읽기 =====

export interface ParsedWorkbook {
  companies: CompanyRowInput[];
  members: MemberRowInput[];
  errors: ParseError[];
  warnings: ParseWarning[];
}

export async function parseCompaniesWorkbook(buffer: ArrayBuffer | Buffer): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  // exceljs 는 ArrayBuffer 와 Buffer 모두 런타임에서 지원하지만, 타입 정의가 좁음 → 캐스팅
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);

  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const companies: CompanyRowInput[] = [];
  const members: MemberRowInput[] = [];

  const companySheet = wb.getWorksheet(COMPANY_SHEET_NAME);
  const memberSheet = wb.getWorksheet(MEMBER_SHEET_NAME);

  if (!companySheet) {
    errors.push({ sheet: COMPANY_SHEET_NAME, rowIndex: 0, message: `"${COMPANY_SHEET_NAME}" 시트가 없습니다.` });
  }
  if (!memberSheet) {
    errors.push({ sheet: MEMBER_SHEET_NAME, rowIndex: 0, message: `"${MEMBER_SHEET_NAME}" 시트가 없습니다.` });
  }

  if (companySheet) {
    errors.push(...validateHeader(companySheet.getRow(1), COMPANY_HEADERS, COMPANY_SHEET_NAME));
    const lastRow = companySheet.lastRow?.number ?? 1;
    for (let r = 2; r <= lastRow; r++) {
      const row = companySheet.getRow(r);
      const name = cellText(row.getCell(1));
      const bizNo = cellText(row.getCell(2));
      const typeLabel = cellText(row.getCell(3));
      const managerName = cellText(row.getCell(4));
      const phone = cellText(row.getCell(5));
      const statusLabel = cellText(row.getCell(6));
      const note = cellText(row.getCell(7));

      // 완전 빈 줄 skip
      if (!name && !bizNo && !typeLabel && !managerName && !phone && !statusLabel && !note) continue;

      if (!name) {
        errors.push({ sheet: COMPANY_SHEET_NAME, rowIndex: r, field: '업체명', message: '업체명이 비어 있습니다.' });
        continue;
      }
      const companyType = typeLabel
        ? COMPANY_TYPE_BY_LABEL.get(typeLabel)
        : 'GENERAL';
      if (!companyType) {
        errors.push({
          sheet: COMPANY_SHEET_NAME,
          rowIndex: r,
          field: '업체구분',
          message: `알 수 없는 업체구분: "${typeLabel}". 허용: ${COMPANY_TYPES.map((t) => t.label).join(', ')}`,
        });
        continue;
      }
      const status = statusLabel ? COMPANY_STATUS_BY_LABEL.get(statusLabel) : 'ACTIVE';
      if (!status) {
        errors.push({
          sheet: COMPANY_SHEET_NAME,
          rowIndex: r,
          field: '상태',
          message: `알 수 없는 상태: "${statusLabel}". 허용: ${COMPANY_STATUS.map((s) => s.label).join(', ')}`,
        });
        continue;
      }

      companies.push({
        rowIndex: r,
        name,
        bizNo: bizNo || null,
        companyType,
        managerName: managerName || null,
        phone: normalizePhone(phone) || null,
        status,
        note: note || null,
      });
    }
  }

  if (memberSheet) {
    errors.push(...validateHeader(memberSheet.getRow(1), MEMBER_HEADERS, MEMBER_SHEET_NAME));
    const lastRow = memberSheet.lastRow?.number ?? 1;
    for (let r = 2; r <= lastRow; r++) {
      const row = memberSheet.getRow(r);
      const memberTypeLabelCell = cellText(row.getCell(1));
      const companyName = cellText(row.getCell(2));
      const name = cellText(row.getCell(3));
      const birthRaw = cellText(row.getCell(4));
      const phoneRaw = cellText(row.getCell(5));
      const vehicleNumber = cellText(row.getCell(6));
      const equipmentLabel = cellText(row.getCell(7));
      const equipmentEtc = cellText(row.getCell(8));
      const spec = cellText(row.getCell(9));
      const note = cellText(row.getCell(10));

      if (
        !memberTypeLabelCell && !companyName && !name && !birthRaw && !phoneRaw &&
        !vehicleNumber && !equipmentLabel && !equipmentEtc && !spec && !note
      ) {
        continue;
      }

      if (!name) {
        errors.push({ sheet: MEMBER_SHEET_NAME, rowIndex: r, field: '이름', message: '이름이 비어 있습니다.' });
        continue;
      }
      if (!companyName) {
        errors.push({ sheet: MEMBER_SHEET_NAME, rowIndex: r, field: '업체명', message: '업체명이 비어 있습니다.' });
        continue;
      }

      const memberType = memberTypeLabelCell
        ? MEMBER_TYPE_BY_LABEL.get(memberTypeLabelCell)
        : 'WORKER';
      if (!memberType) {
        errors.push({
          sheet: MEMBER_SHEET_NAME,
          rowIndex: r,
          field: '구분',
          message: `알 수 없는 구분: "${memberTypeLabelCell}". 허용: ${MEMBER_TYPES.map((m) => m.label).join(', ')}`,
        });
        continue;
      }

      const birthDate = birthRaw ? normalizeDate(birthRaw) : null;
      if (birthRaw && !birthDate) {
        errors.push({
          sheet: MEMBER_SHEET_NAME,
          rowIndex: r,
          field: '생년월일',
          message: `생년월일 형식이 올바르지 않습니다: "${birthRaw}". 허용: YYYY-MM-DD / YYYY/MM/DD / YYYYMMDD`,
        });
        continue;
      }

      let equipmentType: EquipmentType | null = null;
      if (equipmentLabel) {
        const code = EQUIPMENT_TYPE_BY_LABEL.get(equipmentLabel);
        if (!code) {
          errors.push({
            sheet: MEMBER_SHEET_NAME,
            rowIndex: r,
            field: '장비종류',
            message: `알 수 없는 장비종류: "${equipmentLabel}". 허용: ${EQUIPMENT_TYPES.map((e) => e.label).join(', ')}`,
          });
          continue;
        }
        equipmentType = code;
      }
      if (equipmentType === 'ETC' && !equipmentEtc) {
        warnings.push({
          sheet: MEMBER_SHEET_NAME,
          rowIndex: r,
          message: '장비종류가 "기타" 인데 "기타장비명" 이 비어 있습니다.',
        });
      }

      const normalized = normalizePhone(phoneRaw);

      members.push({
        rowIndex: r,
        memberType,
        companyName,
        name,
        birthDate,
        phone: phoneRaw || null,
        normalizedPhone: normalized,
        vehicleNumber: vehicleNumber || null,
        equipmentType,
        equipmentTypeEtc: equipmentEtc || null,
        spec: spec || null,
        note: note || null,
      });
    }
  }

  return { companies, members, errors, warnings };
}

// ===== 워크북 생성 (다운로드용) =====

export interface CompanyExportRow {
  name: string;
  biz_no: string | null;
  company_type: CompanyType;
  manager_name: string | null;
  phone: string | null;
  status: CompanyStatus;
  note: string | null;
}

export interface MemberExportRow {
  member_type: MemberType;
  company_name: string;
  name: string;
  birth_date: string | null;
  phone: string | null;
  vehicle_number: string | null;
  equipment_type: EquipmentType | null;
  equipment_type_etc: string | null;
  spec: string | null;
  note: string | null;
}

export async function buildCompaniesWorkbook(opts: {
  companies: CompanyExportRow[];
  members: MemberExportRow[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'safety-edu';
  wb.created = new Date(0); // 결정적 출력 (운영 추적용으로 고정)

  const cs = wb.addWorksheet(COMPANY_SHEET_NAME);
  cs.addRow([...COMPANY_HEADERS]);
  cs.getRow(1).font = { bold: true };
  cs.columns = COMPANY_HEADERS.map(() => ({ width: 16 }));
  for (const c of opts.companies) {
    cs.addRow([
      c.name,
      c.biz_no ?? '',
      companyTypeLabel(c.company_type),
      c.manager_name ?? '',
      c.phone ?? '',
      companyStatusLabel(c.status),
      c.note ?? '',
    ]);
  }

  const ms = wb.addWorksheet(MEMBER_SHEET_NAME);
  ms.addRow([...MEMBER_HEADERS]);
  ms.getRow(1).font = { bold: true };
  ms.columns = MEMBER_HEADERS.map(() => ({ width: 14 }));
  for (const m of opts.members) {
    ms.addRow([
      memberTypeLabel(m.member_type),
      m.company_name,
      m.name,
      m.birth_date ?? '',
      m.phone ?? '',
      m.vehicle_number ?? '',
      m.equipment_type ? equipmentTypeLabel(m.equipment_type) : '',
      m.equipment_type_etc ?? '',
      m.spec ?? '',
      m.note ?? '',
    ]);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ===== 업체별(단일 업체) 통합 인원 — 다운로드/업로드 =====

export const COMPANY_INFO_SHEET_NAME = '업체정보';
export const ROSTER_MEMBER_SHEET_NAME = '인원';

/** 업체별 인원 시트 헤더. 앞 9개 = 편집(업로드 반영) / 뒤 3개 = 계산(업로드 시 무시) */
export const ROSTER_MEMBER_HEADERS = [
  '이름',
  '대상구분',
  '생년월일',
  '연락처',
  '차량번호',
  '장비종류',
  '기타장비명',
  '톤수규격',
  '비고',
  '교육수료일',
  '유효기간',
  '상태',
] as const;

const COMPLETION_STATUS_LABEL: Record<'VALID' | 'EXPIRING7' | 'EXPIRED' | 'NONE', string> = {
  VALID: '유효',
  EXPIRING7: '만료예정',
  EXPIRED: '만료',
  NONE: '미이수',
};

function isoToDate(iso: string | null): string {
  if (!iso) return '';
  // ISO 문자열 앞 10자(YYYY-MM-DD). 화면 모달과 동일 표기.
  return String(iso).substring(0, 10);
}

export interface RosterExportCompany {
  name: string;
  biz_no: string | null;
  company_type: CompanyType;
  manager_name: string | null;
  phone: string | null;
  status: CompanyStatus;
  created_by: string | null;
}

export interface RosterExportMember {
  member_type: MemberType | null;
  name: string;
  birth_date: string | null;
  phone: string | null;
  vehicle_number: string | null;
  equipment_type: EquipmentType | null;
  equipment_type_etc: string | null;
  spec: string | null;
  note: string | null;
  completed_at: string | null;
  expires_at: string | null;
  completion_status: 'VALID' | 'EXPIRING7' | 'EXPIRED' | 'NONE';
}

/** 단일 업체 .xlsx — 시트1 업체정보 / 시트2 인원(통합·교육상태 포함). */
export async function buildCompanyRosterWorkbook(opts: {
  company: RosterExportCompany;
  members: RosterExportMember[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'safety-edu';
  wb.created = new Date(0);

  // 시트1: 업체정보 (항목/내용)
  const info = wb.addWorksheet(COMPANY_INFO_SHEET_NAME);
  info.addRow(['항목', '내용']);
  info.getRow(1).font = { bold: true };
  info.columns = [{ width: 16 }, { width: 36 }];
  const c = opts.company;
  const createdByLabel = c.created_by === 'APPLICANT' ? '신청자' : c.created_by === 'ADMIN' ? '관리자' : '';
  info.addRow(['업체명', c.name]);
  info.addRow(['사업자번호', c.biz_no ?? '']);
  info.addRow(['업체구분', companyTypeLabel(c.company_type)]);
  info.addRow(['관리자명', c.manager_name ?? '']);
  info.addRow(['연락처', c.phone ?? '']);
  info.addRow(['상태', companyStatusLabel(c.status)]);
  info.addRow(['등록주체', createdByLabel]);

  // 시트2: 인원
  const ms = wb.addWorksheet(ROSTER_MEMBER_SHEET_NAME);
  ms.addRow([...ROSTER_MEMBER_HEADERS]);
  ms.getRow(1).font = { bold: true };
  ms.columns = ROSTER_MEMBER_HEADERS.map(() => ({ width: 14 }));
  for (const m of opts.members) {
    ms.addRow([
      m.name,
      m.member_type ? memberTypeLabel(m.member_type) : '작업자',
      m.birth_date ?? '',
      m.phone ?? '',
      m.vehicle_number ?? '',
      m.equipment_type ? equipmentTypeLabel(m.equipment_type) : '',
      m.equipment_type_etc ?? '',
      m.spec ?? '',
      m.note ?? '',
      isoToDate(m.completed_at),
      isoToDate(m.expires_at),
      COMPLETION_STATUS_LABEL[m.completion_status],
    ]);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ===== 업체별 인원 업로드 파싱(헤더 라벨 기반 — 계산 컬럼 무시) =====

export interface CompanyMemberRowInput {
  rowIndex: number;
  memberType: MemberType;
  name: string;
  birthDate: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  vehicleNumber: string | null;
  equipmentType: EquipmentType | null;
  equipmentTypeEtc: string | null;
  spec: string | null;
  note: string | null;
}

export interface ParsedCompanyMembers {
  members: CompanyMemberRowInput[];
  errors: ParseError[];
  warnings: ParseWarning[];
}

function buildHeaderIndex(headerRow: ExcelJS.Row | undefined): Map<string, number> {
  const idx = new Map<string, number>();
  if (!headerRow) return idx;
  for (let col = 1; col <= 40; col++) {
    const label = cellText(headerRow.getCell(col));
    if (label && !idx.has(label)) idx.set(label, col);
  }
  return idx;
}

/**
 * 단일 업체 인원 업로드 파싱.
 * - "인원" 시트(없으면 첫 시트). 헤더 라벨로 컬럼 위치 탐지(계산 컬럼 교육수료일/유효기간/상태는 무시).
 * - 업체명 컬럼은 보지 않음(업체는 URL 경로로 고정 → 타업체 혼입 차단).
 * - 키: name + birth_date + normalized_phone (호출측에서 company_id 와 함께 upsert).
 */
export async function parseCompanyMembersWorkbook(
  buffer: ArrayBuffer | Buffer
): Promise<ParsedCompanyMembers> {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buffer as any);

  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];
  const members: CompanyMemberRowInput[] = [];

  const sheet = wb.getWorksheet(ROSTER_MEMBER_SHEET_NAME) ?? wb.worksheets[0];
  if (!sheet) {
    errors.push({ sheet: ROSTER_MEMBER_SHEET_NAME, rowIndex: 0, message: `"${ROSTER_MEMBER_SHEET_NAME}" 시트가 없습니다.` });
    return { members, errors, warnings };
  }

  const hi = buildHeaderIndex(sheet.getRow(1));

  // 잘못된 양식 차단 — "업체명" 컬럼이 있으면 다업체 통합 양식(/api/admin/companies/export)을
  // 단일 업체 업로드에 잘못 올린 것. 그대로 받으면 타업체 인원이 현 업체로 흡수됨(파서는 보안상
  // 업체명 컬럼을 읽지 않으므로 침묵의 데이터 오염). 헤더에서 즉시 거부.
  if (hi.has('업체명')) {
    errors.push({
      sheet: sheet.name,
      rowIndex: 1,
      field: '업체명',
      message: '다업체 통합 양식이 감지되었습니다(업체명 컬럼 존재). 이 업로드는 단일 업체 양식만 받습니다 — 해당 업체의 "📥 다운로드"로 받은 파일을 사용하세요.',
    });
    return { members, errors, warnings };
  }

  const colName = hi.get('이름');
  if (!colName) {
    errors.push({ sheet: sheet.name, rowIndex: 1, field: '이름', message: '"이름" 컬럼을 찾을 수 없습니다. (업체별 인원 양식을 사용하세요)' });
    return { members, errors, warnings };
  }
  const colType = hi.get('대상구분') ?? hi.get('구분');
  const colBirth = hi.get('생년월일');
  const colPhone = hi.get('연락처');
  const colVeh = hi.get('차량번호');
  const colEq = hi.get('장비종류');
  const colEqEtc = hi.get('기타장비명');
  const colSpec = hi.get('톤수규격') ?? hi.get('규격');
  const colNote = hi.get('비고');

  const get = (row: ExcelJS.Row, col: number | undefined): string =>
    col ? cellText(row.getCell(col)) : '';

  const lastRow = sheet.lastRow?.number ?? 1;
  for (let r = 2; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    const name = get(row, colName);
    const typeLabel = get(row, colType);
    const birthRaw = get(row, colBirth);
    const phoneRaw = get(row, colPhone);
    const vehicle = get(row, colVeh);
    const eqLabel = get(row, colEq);
    const eqEtc = get(row, colEqEtc);
    const spec = get(row, colSpec);
    const note = get(row, colNote);

    if (!name && !typeLabel && !birthRaw && !phoneRaw && !vehicle && !eqLabel && !eqEtc && !spec && !note) {
      continue; // 완전 빈 줄
    }
    if (!name) {
      errors.push({ sheet: sheet.name, rowIndex: r, field: '이름', message: '이름이 비어 있습니다.' });
      continue;
    }

    const memberType = typeLabel ? MEMBER_TYPE_BY_LABEL.get(typeLabel) : 'WORKER';
    if (!memberType) {
      errors.push({
        sheet: sheet.name,
        rowIndex: r,
        field: '대상구분',
        message: `알 수 없는 대상구분: "${typeLabel}". 허용: ${MEMBER_TYPES.map((m) => m.label).join(', ')}`,
      });
      continue;
    }

    const birthDate = birthRaw ? normalizeDate(birthRaw) : null;
    if (birthRaw && !birthDate) {
      errors.push({
        sheet: sheet.name,
        rowIndex: r,
        field: '생년월일',
        message: `생년월일 형식이 올바르지 않습니다: "${birthRaw}". 허용: YYYY-MM-DD / YYYY/MM/DD / YYYYMMDD`,
      });
      continue;
    }

    let equipmentType: EquipmentType | null = null;
    if (eqLabel) {
      const code = EQUIPMENT_TYPE_BY_LABEL.get(eqLabel);
      if (!code) {
        errors.push({
          sheet: sheet.name,
          rowIndex: r,
          field: '장비종류',
          message: `알 수 없는 장비종류: "${eqLabel}". 허용: ${EQUIPMENT_TYPES.map((e) => e.label).join(', ')}`,
        });
        continue;
      }
      equipmentType = code;
    }
    if (equipmentType === 'ETC' && !eqEtc) {
      warnings.push({ sheet: sheet.name, rowIndex: r, message: '장비종류가 "기타"인데 "기타장비명"이 비어 있습니다.' });
    }

    members.push({
      rowIndex: r,
      memberType,
      name,
      birthDate,
      phone: phoneRaw || null,
      normalizedPhone: normalizePhone(phoneRaw),
      vehicleNumber: vehicle || null,
      equipmentType,
      equipmentTypeEtc: eqEtc || null,
      spec: spec || null,
      note: note || null,
    });
  }

  return { members, errors, warnings };
}

// re-exports for callers that only import this module
export { isCompanyStatus, isCompanyType, isEquipmentType, isMemberType };
