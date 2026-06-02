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
import { WORK_TYPES, type WorkTypeHeaderCells } from './work-permit-types';
import type { DocsOutput } from './safety-doc-status';

export const SHEET_GENERAL = '2_일반위험작업허가서';
export const SHEET_TBM = '1_TBM(작업전안전미팅)';
export const SHEET_PLEDGE = '8_안전준수서약(개인)';
export const SHEET_UNDERTAKING = '9_안전작업이행각서(업체)';
export const SHEET_EDU = '7_교육훈련결과서';

/** 1C-2 필수문서 시트 셀 매핑 */
export const DOC_CELLS = {
  pledge: {
    name: 'B3', companyName: 'D3', birth: 'B4', nationality: 'D4',
    phone: 'B5', bloodType: 'D5', jobType: 'B6', workDate: 'D6',
  },
  undertaking: {
    company: 'A3', area: 'A4', period: 'A5', manager: 'A6',
    memberRowStart: 8, memberRowEnd: 17, // 10행: 성명 B / 생년월일 C / 연락처 D
  },
  edu: {
    datetime: 'A2', content: 'A4',
    leftRowStart: 8, leftRowEnd: 31, // 성명 B (1~24)
    rightRowStart: 8, rightRowEnd: 31, // 성명 E (25~48)
  },
} as const;

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
  docs?: DocsOutput; // 1C-2 필수문서(있으면 시트 8 N장·9·7 채움)
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

function birthFront(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  return `${m[1].slice(2)}${m[2]}${m[3]}`; // YYMMDD
}

/**
 * 워크시트 깊은 복제 — ExcelJS는 자동복사 안 됨 → 열폭·행높이·셀값·스타일·병합 명시 복사.
 */
function cloneWorksheet(wb: ExcelJS.Workbook, source: ExcelJS.Worksheet, newName: string): ExcelJS.Worksheet {
  const dst = wb.addWorksheet(newName, {
    properties: { ...(source.properties as any) },
    pageSetup: { ...(source.pageSetup as any) },
  });
  // 열 너비
  const colCount = source.columnCount;
  for (let c = 1; c <= colCount; c++) {
    const w = source.getColumn(c).width;
    if (w) dst.getColumn(c).width = w;
  }
  // 행/셀 (값 + 스타일 + 높이)
  source.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const dRow = dst.getRow(rowNumber);
    if (row.height) dRow.height = row.height;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const dCell = dRow.getCell(colNumber);
      dCell.value = cell.value as any;
      if (cell.style) {
        try { dCell.style = JSON.parse(JSON.stringify(cell.style)); } catch { /* */ }
      }
    });
  });
  // 병합셀
  const merges: string[] = ((source.model as any)?.merges) || [];
  for (const m of merges) {
    try { dst.mergeCells(m); } catch { /* 이미 병합 */ }
  }
  return dst;
}

/** 개인서약 1장 채움 (anchor 셀만). 디지털 서명 있으면 서명란 영역에 이미지 삽입 */
function fillPledgeSheet(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, p: DocsOutput['pledges'][number]) {
  const C = DOC_CELLS.pledge;
  ws.getCell(C.name).value = p.name;
  ws.getCell(C.companyName).value = p.companyName ?? '';
  ws.getCell(C.birth).value = birthFront(p.birthDate);
  ws.getCell(C.nationality).value = p.nationality ?? ''; // 프리필 덮어쓰기
  ws.getCell(C.phone).value = p.phone ?? '';
  ws.getCell(C.bloodType).value = p.bloodType ?? '';     // 프리필 '형' 덮어쓰기
  ws.getCell(C.jobType).value = p.jobType ?? '';
  ws.getCell(C.workDate).value = p.workDate ? fmtDate(p.workDate) : '';

  // 디지털 서명 이미지 — 하단 서명블록(A24:F25)의 '(서명)' 영역 근처에 앉힘
  if (p.signature && p.signature.startsWith('data:image/')) {
    try {
      const base64 = p.signature.replace(/^data:image\/\w+;base64,/, '');
      const imageId = wb.addImage({ base64, extension: 'png' });
      // tl/ext: 0-indexed col/row + 픽셀 크기. 하단 'A24:F25' 병합칸의 3번째 줄(서약자·(서명)) 위에 앉힘.
      ws.addImage(imageId, {
        tl: { col: 3.8, row: 24.25 },
        ext: { width: 120, height: 30 },
      } as any);
    } catch (e) {
      console.error('[pledge] signature image embed failed:', e);
    }
  }
}

/** 이행각서 1장 채움 */
function fillUndertakingSheet(ws: ExcelJS.Worksheet, u: NonNullable<DocsOutput['undertaking']>) {
  const C = DOC_CELLS.undertaking;
  ws.getCell(C.company).value = `◎ 소속사명 : ${u.companyName ?? ''}`;
  ws.getCell(C.area).value = `◎ 작업구역 : ${u.workArea ?? ''}`;
  const period =
    u.issuedAt && u.expiresAt ? `${fmtDate(u.issuedAt)} ~ ${fmtDate(u.expiresAt)}` : '';
  ws.getCell(C.period).value = `◎ 출입기간 : ${period}`;
  ws.getCell(C.manager).value = `◎ 관리감독자 : ${u.managerName ?? ''}        연락처 : ${u.managerPhone ?? ''}`;
  const cap = C.memberRowEnd - C.memberRowStart + 1; // 10
  u.members.slice(0, cap).forEach((m, i) => {
    const r = C.memberRowStart + i;
    ws.getCell(`B${r}`).value = m.name ?? '';
    ws.getCell(`C${r}`).value = birthFront(m.birthDate);
    ws.getCell(`D${r}`).value = m.phone ?? '';
    // 서명 E / 비고 F 빈칸
  });
  // 대표/현장소장 인(A29) 미변경 — 현장
}

/** 교육결과서 1장 채움 */
function fillEduSheet(ws: ExcelJS.Worksheet, e: DocsOutput['eduResult']) {
  const C = DOC_CELLS.edu;
  ws.getCell(C.datetime).value = `1. 교육 일시 : ${e.date ? fmtDate(e.date) : ''}`;
  ws.getCell(C.content).value = `2. 교육 내용 : ${e.content ?? ''}`;
  const leftCap = C.leftRowEnd - C.leftRowStart + 1; // 24
  e.names.forEach((nm, i) => {
    if (i < leftCap) {
      ws.getCell(`B${C.leftRowStart + i}`).value = nm;
    } else {
      const idx = i - leftCap;
      if (idx < (C.rightRowEnd - C.rightRowStart + 1)) {
        ws.getCell(`E${C.rightRowStart + idx}`).value = nm;
      }
    }
    // 서명 빈칸
  });
  // 실시자(A32) 미변경 — 현장
}

/** 필수문서 시트 채움: 개인서약 N장(시트 복제) + 이행각서 1장 + 교육결과서 1장 */
function fillDocSheets(wb: ExcelJS.Workbook, docs: DocsOutput) {
  // 개인서약: 원본 시트를 1번 참여자용으로 쓰고, 2번부터는 복제
  const pledgeSrc = wb.getWorksheet(SHEET_PLEDGE);
  if (pledgeSrc && docs.pledges.length > 0) {
    pledgeSrc.name = `${SHEET_PLEDGE}(1)`;
    fillPledgeSheet(wb, pledgeSrc, docs.pledges[0]);
    for (let i = 1; i < docs.pledges.length; i++) {
      const clone = cloneWorksheet(wb, pledgeSrc, `${SHEET_PLEDGE}(${i + 1})`);
      fillPledgeSheet(wb, clone, docs.pledges[i]);
    }
  }
  // 이행각서
  const us = wb.getWorksheet(SHEET_UNDERTAKING);
  if (us && docs.undertaking) fillUndertakingSheet(us, docs.undertaking);
  // 교육결과서
  const es = wb.getWorksheet(SHEET_EDU);
  if (es) fillEduSheet(es, docs.eduResult);
}

/** 1C-3 보충작업 별지: 종류별 시트 공통 헤더만 채움(안전조치·측정·서명은 빈칸=현장). */
function fillSupplementalHeader(
  ws: ExcelJS.Worksheet,
  cells: WorkTypeHeaderCells,
  data: PermitDocData
) {
  const info = data.info;
  const title = (info.applicantTitle ?? '').trim();
  setCell(ws, cells.permitNumber, data.permitNumber);
  setCell(ws, cells.permitDate, fmtDate(data.createdAt));
  setCell(
    ws,
    cells.applicant,
    `직책: ${title}    성명: ${info.applicantName}                    (서명)`
  );
  setCell(ws, cells.period, `${fmtDateTime(info.workStart)} ~ ${fmtTime(info.workEnd)}`);
  setCell(
    ws,
    cells.location,
    `정비작업 신청번호: \n작업지역(장소): ${info.workLocation}\n장치번호 / 장치명: ${(info.equipmentNo ?? '').trim()}`,
    true
  );
  setCell(
    ws,
    cells.overview,
    `[업체] ${data.companyName} / [작업명] ${info.workName}\n${info.workContent}`,
    true
  );
  // ※ 관련 작업허가 체크·안전조치·가스측정·서명란은 손대지 않음(현장).
}

/**
 * 보충작업(Y) 체크된 종류만 헤더 채움 + 미체크 종류 시트는 출력에서 제거.
 * (템플릿엔 7종 시트가 이미 포함돼 있어, 조건부 제거가 "체크분만 별지 첨부"와 동치)
 */
function applySupplementalSheets(wb: ExcelJS.Workbook, data: PermitDocData) {
  const supp = data.supplemental ?? {};
  for (const t of WORK_TYPES) {
    const ws = wb.getWorksheet(t.sheet);
    if (!ws) continue; // 시트 없으면 스킵(템플릿 변경 대비)
    if (supp[t.key] === 'Y') {
      fillSupplementalHeader(ws, t.cells, data);
    } else {
      // 미체크 종류는 출력에서 제거
      try {
        wb.removeWorksheet(ws.id);
      } catch (e) {
        console.error(`[supplemental] removeWorksheet failed: ${t.sheet}`, e);
      }
    }
  }
}

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

  // ===== 1C-2 필수문서(있으면 채움) =====
  if (data.docs) {
    fillDocSheets(wb, data.docs);
  }

  // ===== 1C-3 보충작업 별지(체크분만 헤더 채움 + 미체크 시트 제거) =====
  applySupplementalSheets(wb, data);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export const __fmt = { fmtDate, fmtDateTime, fmtTime }; // 테스트/재사용
