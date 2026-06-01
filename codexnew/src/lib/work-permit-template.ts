/**
 * 회사 양식(.xlsx) 자동 채움 — 서버 전용(ExcelJS).
 * 템플릿: src/lib/templates/work-permit-template.xlsx (public 노출 금지).
 *
 * 규칙(계획서 ★권위본):
 *  ① 병합셀은 **좌상단(anchor) 셀에만** 쓴다(비-anchor 무시됨).
 *  ② 프리필 문자열은 통째 덮어쓰되 '(서명)' 표식은 남기고 실제 서명은 비운다(현장 수기).
 *  ③ 보충작업 체크는 셀 안 해당 라벨 앞 '□' → '■' 문자 치환(여러 □ 중 선택).
 *  ④ 안전조치 16항목·TBM 위험요인·점검·날씨·가스농도·모든 서명 = 양식 빈칸(현장).
 *  ⑤ 참여자 25명↑이면 그리드(24칸) 초과분은 기타 특별사항(A35)에 비고.
 *  시트명 정확히: '2_일반위험작업허가서', '1_TBM(작업전안전미팅)'.
 */

import path from 'path';
import ExcelJS from 'exceljs';
import { SUPPLEMENTAL_WORKS } from './work-permit-constants';

export const SHEET_GENERAL = '2_일반위험작업허가서';
export const SHEET_TBM = '1_TBM(작업전안전미팅)';

/** 셀 매핑 — 라벨/양식 변경 시 이 상수만 수정 */
export const TEMPLATE_CELLS = {
  general: {
    permitNumber: 'B2', // B2:D2
    permitDate: 'G2', // G2:I2 (프리필 '20  년  월  일')
    applicant: 'B3', // B3:I3 (프리필 '직책: 성명: (서명)')
    period: 'B4', // B4:I4
    location: 'A6', // A6:B8 (멀티라인 프리필)
    overview: 'C6', // C6:D8
    etc: 'A35', // A35:I35 기타 특별사항
    // 보충작업 체크는 SUPPLEMENTAL_WORKS[].cell/token 으로 처리
  },
  tbm: {
    datetime: 'B3', // B3:C3
    place: 'G3', // G3:I3
    workName: 'B4', // B4:I4
    teamLeader: 'B5', // B5:D5 (프리필 '소속: 성명: (서명)')
    // 참석자 그리드: 좌 행30~41(성명 B/소속 C/서명 D), 우 행30~41(성명 G/소속 H/서명 I)
    participantRowStart: 30,
    participantRowEnd: 41, // 12행 × 2열 = 24칸
  },
} as const;

// ===== 데이터 형 (GET /api/work-permits/[id] 와 동일 형태) =====
export interface PermitDocData {
  permitNumber: string;
  companyName: string;
  info: {
    workName: string;
    workLocation: string;
    workStart: string; // ISO
    workEnd: string; // ISO
    workContent: string;
    applicantName: string;
    applicantTitle?: string | null;
    equipmentNo?: string | null;
  };
  supplemental: Record<string, 'Y' | 'N' | undefined>;
  participants: {
    name: string | null;
    companyName: string | null;
  }[];
  note?: string | null;
  createdAt: string; // ISO
}

// ===== KST 포맷터 (ICU 비의존: UTC+9 수동) =====
function toKST(iso: string): Date {
  return new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
}
function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function fmtDate(iso: string): string {
  const k = toKST(iso);
  return `${k.getUTCFullYear()}. ${pad(k.getUTCMonth() + 1)}. ${pad(k.getUTCDate())}`;
}
function fmtDateTime(iso: string): string {
  const k = toKST(iso);
  return `${k.getUTCFullYear()}.${pad(k.getUTCMonth() + 1)}.${pad(k.getUTCDate())} ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`;
}
function fmtTime(iso: string): string {
  const k = toKST(iso);
  return `${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`;
}

function setCell(ws: ExcelJS.Worksheet, addr: string, value: string, multiline = false) {
  const cell = ws.getCell(addr);
  cell.value = value;
  if (multiline) {
    const prev = cell.alignment ?? {};
    cell.alignment = { ...prev, wrapText: true, vertical: 'top' };
  }
}

/** 보충작업 체크: 해당 셀의 라벨 앞 '□' → '■' */
function applySupplementalChecks(
  ws: ExcelJS.Worksheet,
  supplemental: Record<string, 'Y' | 'N' | undefined>
) {
  // 셀별로 현재 문자열을 읽어 토큰 치환 후 다시 쓴다.
  const byCell = new Map<string, string>();
  for (const w of SUPPLEMENTAL_WORKS) {
    if (!byCell.has(w.cell)) {
      const raw = ws.getCell(w.cell).value;
      byCell.set(w.cell, typeof raw === 'string' ? raw : String(raw ?? ''));
    }
    if (supplemental[w.key] === 'Y') {
      const cur = byCell.get(w.cell)!;
      // '□' + 선택적 공백 + 토큰  →  '■' + 동일 공백 + 토큰
      const re = new RegExp('□(\\s*)' + w.token);
      byCell.set(w.cell, cur.replace(re, '■$1' + w.token));
    }
  }
  for (const [addr, val] of byCell) {
    ws.getCell(addr).value = val;
  }
}

const TEMPLATE_PATH = path.join(process.cwd(), 'src', 'lib', 'templates', 'work-permit-template.xlsx');

/**
 * 작업허가서 양식을 채워 xlsx 버퍼를 반환.
 * 1C-1: 일반위험작업허가서 + TBM 헤더/참석자만 채움. 나머지 시트·빈칸은 그대로.
 */
export async function fillWorkPermitWorkbook(data: PermitDocData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);

  const gs = wb.getWorksheet(SHEET_GENERAL);
  const ts = wb.getWorksheet(SHEET_TBM);
  if (!gs || !ts) {
    throw new Error('TEMPLATE_SHEET_MISSING');
  }

  const G = TEMPLATE_CELLS.general;
  const T = TEMPLATE_CELLS.tbm;
  const info = data.info;

  // ===== 일반위험작업허가서 =====
  setCell(gs, G.permitNumber, data.permitNumber);
  setCell(gs, G.permitDate, fmtDate(data.createdAt));
  // 신청인: 직책/성명 + (서명) 표식 유지(실서명 공란)
  const title = (info.applicantTitle ?? '').trim();
  setCell(
    gs,
    G.applicant,
    `직책: ${title}    성명: ${info.applicantName}                    (서명)`
  );
  // 허가기간: 시작 전체 ~ 종료 시각
  setCell(
    gs,
    G.period,
    `${fmtDateTime(info.workStart)} ~ ${fmtTime(info.workEnd)}`
  );
  // 작업장소·장치(멀티라인) — 프리필 구조 유지
  setCell(
    gs,
    G.location,
    `정비작업 신청번호: \n작업지역(장소): ${info.workLocation}\n장치번호 / 장치명: ${(info.equipmentNo ?? '').trim()}`,
    true
  );
  // 작업개요 머리에 [업체] 병기
  setCell(gs, G.overview, `[업체] ${data.companyName}\n${info.workContent}`, true);

  // 보충작업 체크
  applySupplementalChecks(gs, data.supplemental ?? {});

  // ===== TBM (헤더·참석자만) =====
  setCell(ts, T.datetime, fmtDateTime(info.workStart));
  setCell(ts, T.place, info.workLocation);
  setCell(ts, T.workName, info.workName);
  setCell(
    ts,
    T.teamLeader,
    `소속: ${data.companyName}    성명: ${info.applicantName}             (서명)`
  );

  // 참석자 그리드 — 좌12·우12 (서명 공란)
  const ps = data.participants ?? [];
  const rows = T.participantRowEnd - T.participantRowStart + 1; // 12
  const capacity = rows * 2; // 24
  const overflow: string[] = [];
  ps.forEach((p, i) => {
    if (i >= capacity) {
      if (p.name) overflow.push(`${p.name}(${p.companyName ?? ''})`);
      return;
    }
    const left = i < rows;
    const r = T.participantRowStart + (left ? i : i - rows);
    const nameCol = left ? 'B' : 'G';
    const compCol = left ? 'C' : 'H';
    ts.getCell(`${nameCol}${r}`).value = p.name ?? '';
    ts.getCell(`${compCol}${r}`).value = p.companyName ?? '';
    // 서명 D/I 공란
  });

  // 기타 특별사항: note + 참여자 초과분
  const etcParts: string[] = [];
  if (data.note && data.note.trim()) etcParts.push(data.note.trim());
  if (overflow.length > 0) etcParts.push(`추가 참여자: ${overflow.join(', ')}`);
  if (etcParts.length > 0) {
    setCell(gs, G.etc, etcParts.join(' / '), true);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export const __fmt = { fmtDate, fmtDateTime, fmtTime }; // 테스트/재사용
