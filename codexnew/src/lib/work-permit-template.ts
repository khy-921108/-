/**
 * 회사 양식(.xlsx) 자동 채움 — 서버 전용(ExcelJS).
 */

import path from 'path';
import ExcelJS from 'exceljs';
import { SUPPLEMENTAL_WORKS } from './work-permit-constants';
import type { DocsOutput } from './safety-doc-status';

export const SHEET_GENERAL = '2_일반위험작업허가서';
export const SHEET_TBM = '1_TBM(작업전안전미팅)';
export const SHEET_PLEDGE = '8_안전준수서약(개인)';
export const SHEET_UNDERTAKING = '9_안전작업이행각서(업체)';
export const SHEET_EDU = '7_교육훈련결과서';

export const DOC_CELLS = {
  pledge: {
    name: 'B3', companyName: 'D3', birth: 'B4', nationality: 'D4',
    phone: 'B5', bloodType: 'D5', jobType: 'B6', workDate: 'D6',
  },
  undertaking: {
    company: 'A3', area: 'A4', period: 'A5', manager: 'A6',
    memberRowStart: 8, memberRowEnd: 17,
  },
  edu: {
    datetime: 'A2', content: 'A4',
    leftRowStart: 8, leftRowEnd: 31,
    rightRowStart: 8, rightRowEnd: 31,
  },
} as const;

export const TEMPLATE_CELLS = {
  general: {
    permitNumber: 'B2',
    permitDate: 'G2',
    applicant: 'B3',
    period: 'B4',
    location: 'A6',
    overview: 'C6',
    etc: 'A35',
  },
  tbm: {
    datetime: 'B3',
    place: 'G3',
    workName: 'B4',
    teamLeader: 'B5',
    participantRowStart: 30,
    participantRowEnd: 41,
  },
} as const;

export interface PermitDocData {
  permitNumber: string;
  companyName: string;
  info: {
    workName: string;
    workLocation: string;
    workStart: string;
    workEnd: string;
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
  createdAt: string;
  docs?: DocsOutput;
}

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

function applySupplementalChecks(
  ws: ExcelJS.Worksheet,
  supplemental: Record<string, 'Y' | 'N' | undefined>
) {
  const byCell = new Map<string, string>();
  for (const w of SUPPLEMENTAL_WORKS) {
    if (!byCell.has(w.cell)) {
      const raw = ws.getCell(w.cell).value;
      byCell.set(w.cell, typeof raw === 'string' ? raw : String(raw ?? ''));
    }
    if (supplemental[w.key] === 'Y') {
      const cur = byCell.get(w.cell)!;
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
  return `${m[1].slice(2)}${m[2]}${m[3]}`;
}

function cloneWorksheet(wb: ExcelJS.Workbook, source: ExcelJS.Worksheet, newName: string): ExcelJS.Worksheet {
  const dst = wb.addWorksheet(newName, {
    properties: { ...(source.properties as any) },
    pageSetup: { ...(source.pageSetup as any) },
  });
  const colCount = source.columnCount;
  for (let c = 1; c <= colCount; c++) {
    const w = source.getColumn(c).width;
    if (w) dst.getColumn(c).width = w;
  }
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
  const merges: string[] = ((source.model as any)?.merges) || [];
  for (const m of merges) {
    try { dst.mergeCells(m); } catch { /* */ }
  }
  return dst;
}

function fillPledgeSheet(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, p: DocsOutput['pledges'][number]) {
  const C = DOC_CELLS.pledge;
  ws.getCell(C.name).value = p.name;
  ws.getCell(C.companyName).value = p.companyName ?? '';
  ws.getCell(C.birth).value = birthFront(p.birthDate);
  ws.getCell(C.nationality).value = p.nationality ?? '';
  ws.getCell(C.phone).value = p.phone ?? '';
  ws.getCell(C.bloodType).value = p.bloodType ?? '';
  ws.getCell(C.jobType).value = p.jobType ?? '';
  ws.getCell(C.workDate).value = p.workDate ? fmtDate(p.workDate) : '';

  if (p.signature && p.signature.startsWith('data:image/')) {
    try {
      const base64 = p.signature.replace(/^data:image\/\w+;base64,/, '');
      const imageId = wb.addImage({ base64, extension: 'png' });
      ws.addImage(imageId, {
        tl: { col: 3.7, row: 23.45 },
        ext: { width: 130, height: 42 },
      } as any);
    } catch (e) {
      console.error('[pledge] signature image embed failed:', e);
    }
  }
}

function fillUndertakingSheet(ws: ExcelJS.Worksheet, u: NonNullable<DocsOutput['undertaking']>) {
  const C = DOC_CELLS.undertaking;
  ws.getCell(C.company).value = `◎ 소속사명 : ${u.companyName ?? ''}`;
  ws.getCell(C.area).value = `◎ 작업구역 : ${u.workArea ?? ''}`;
  const period =
    u.issuedAt && u.expiresAt ? `${fmtDate(u.issuedAt)} ~ ${fmtDate(u.expiresAt)}` : '';
  ws.getCell(C.period).value = `◎ 출입기간 : ${period}`;
  ws.getCell(C.manager).value = `◎ 관리감독자 : ${u.managerName ?? ''}        연락처 : ${u.managerPhone ?? ''}`;
  const cap = C.memberRowEnd - C.memberRowStart + 1;
  u.members.slice(0, cap).forEach((m, i) => {
    const r = C.memberRowStart + i;
    ws.getCell(`B${r}`).value = m.name ?? '';
    ws.getCell(`C${r}`).value = birthFront(m.birthDate);
    ws.getCell(`D${r}`).value = m.phone ?? '';
  });
}

function fillEduSheet(ws: ExcelJS.Worksheet, e: DocsOutput['eduResult']) {
  const C = DOC_CELLS.edu;
  ws.getCell(C.datetime).value = `1. 교육 일시 : ${e.date ? fmtDate(e.date) : ''}`;
  ws.getCell(C.content).value = `2. 교육 내용 : ${e.content ?? ''}`;
  const leftCap = C.leftRowEnd - C.leftRowStart + 1;
  e.names.forEach((nm, i) => {
    if (i < leftCap) {
      ws.getCell(`B${C.leftRowStart + i}`).value = nm;
    } else {
      const idx = i - leftCap;
      if (idx < (C.rightRowEnd - C.rightRowStart + 1)) {
        ws.getCell(`E${C.rightRowStart + idx}`).value = nm;
      }
    }
  });
}

function fillDocSheets(wb: ExcelJS.Workbook, docs: DocsOutput) {
  const pledgeSrc = wb.getWorksheet(SHEET_PLEDGE);
  if (pledgeSrc && docs.pledges.length > 0) {
    pledgeSrc.name = `${SHEET_PLEDGE}(1)`;
    fillPledgeSheet(wb, pledgeSrc, docs.pledges[0]);
    for (let i = 1; i < docs.pledges.length; i++) {
      const clone = cloneWorksheet(wb, pledgeSrc, `${SHEET_PLEDGE}(${i + 1})`);
      fillPledgeSheet(wb, clone, docs.pledges[i]);
    }
  }
  const us = wb.getWorksheet(SHEET_UNDERTAKING);
  if (us && docs.undertaking) fillUndertakingSheet(us, docs.undertaking);
  const es = wb.getWorksheet(SHEET_EDU);
  if (es) fillEduSheet(es, docs.eduResult);
}

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

  setCell(gs, G.permitNumber, data.permitNumber);
  setCell(gs, G.permitDate, fmtDate(data.createdAt));
  const title = (info.applicantTitle ?? '').trim();
  setCell(gs, G.applicant, `직책: ${title}    성명: ${info.applicantName}                    (서명)`);
  setCell(gs, G.period, `${fmtDateTime(info.workStart)} ~ ${fmtTime(info.workEnd)}`);
  setCell(gs, G.location, `정비작업 신청번호: \n작업지역(장소): ${info.workLocation}\n장치번호 / 장치명: ${(info.equipmentNo ?? '').trim()}`, true);
  setCell(gs, G.overview, `[업체] ${data.companyName}\n${info.workContent}`, true);

  applySupplementalChecks(gs, data.supplemental ?? {});

  setCell(ts, T.datetime, fmtDateTime(info.workStart));
  setCell(ts, T.place, info.workLocation);
  setCell(ts, T.workName, info.workName);
  setCell(ts, T.teamLeader, `소속: ${data.companyName}    성명: ${info.applicantName}             (서명)`);

  const ps = data.participants ?? [];
  const rows = T.participantRowEnd - T.participantRowStart + 1;
  const capacity = rows * 2;
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
  });

  const etcParts: string[] = [];
  if (data.note && data.note.trim()) etcParts.push(data.note.trim());
  if (overflow.length > 0) etcParts.push(`추가 참여자: ${overflow.join(', ')}`);
  if (etcParts.length > 0) {
    setCell(gs, G.etc, etcParts.join(' / '), true);
  }

  if (data.docs) {
    fillDocSheets(wb, data.docs);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export const __fmt = { fmtDate, fmtDateTime, fmtTime };
