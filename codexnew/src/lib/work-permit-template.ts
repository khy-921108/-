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
import { WORK_TYPES, type WorkTypeDef } from './work-permit-types';
import type { DocsOutput } from './safety-doc-status';

export const SHEET_GENERAL = '2_일반위험작업허가서';
export const SHEET_TBM = '1_TBM(작업전안전미팅)';
export const SHEET_TBM_PHOTO = '1-2_TBM현장사진';
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
  // R-6 개정 구조(5행 아래 1행 삽입 → 6행 신설, 이하 전부 +1)
  tbm: {
    datetime: 'B3', // B3:C3
    place: 'G3', // G3:I3
    workName: 'B4', // B4:I4
    company: 'C5', // 작업업체 (라벨 A5:B5, 값 C5:D5) — 자동 채움(ⓓ)
    smAffiliation: 'G5', // 안전관리자 소속 (G5:I5) — v5 템플릿에 "동남" 고정 프리필, 코드 미사용(ⓓ)
    leaderName: 'C6', // 현장소장/안전담당 성명 (라벨 A6:B6, 값 C6)
    leaderSig: 'D6', // 서명칸
    smName: 'G6', // 안전관리자 성명 (G6:H6)
    smSig: 'I6', // 서명칸
    contentRowStart: 9, // 작업내용 B / 위험요인 D / 안전대책 F (행 9~14)
    contentRowEnd: 14,
    // 참석자 그리드: 좌 행31~42(성명 B/소속 C/서명 D), 우 행31~42(성명 G/소속 H/서명 I)
    participantRowStart: 31,
    participantRowEnd: 42, // 12행 × 2열 = 24칸
  },
  // 1-2_TBM현장사진 (사용자 설계: TBM 연장 페이지 스타일, 대형 사진칸 2개. 사진 없으면 시트 제거)
  tbmPhoto: {
    datetime: 'B3', // 일시 (B3:C3)
    place: 'G3', // 장소 (G3:I3)
    anchors: ['A5', 'A17'], // 사진칸 ①(A5:I15) ②(A17:I27) 좌상단
    maxPhotos: 2,
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
  // ===== R-6: 디지털 서명 / 승인 / TBM 상세 / QR (없으면 공란) =====
  applicantSignature?: string | null;
  /** 발급자 = 안전환경담당(gate ③에서 캡처, 없으면 공란) */
  issuer?: { name: string | null; title: string | null; signature: string | null; at: string | null } | null;
  /** 승인자 = 요청·주관부서 현장 책임자(직책/성명은 신청 시, 서명은 gate ③) */
  approval?: { name: string | null; title: string | null; signature: string | null; mode: string | null; at: string | null } | null;
  /** 입회자 = 안전환경 현장입회(2차, gate ③-2a) — 없으면 공란 */
  witness?: { name: string | null; signature: string | null; at: string | null } | null;
  /** 오늘의 안전지시사항(2차 입회 시 입력, gate ③-2a) — 없으면 공란 */
  safetyInstructions?: string | null;
  /** 작업완료 확인(종료란) — gate ③, 없으면 공란. 종료 2단계(신고→확인, ③-2b) 필드 포함 */
  completion?: {
    completedAt?: string; workerSignature?: string; restoreState?: string; witnessName?: string;
    reportBy?: string; reportAt?: string;
    confirmSignature?: string; confirmBy?: string; confirmAt?: string;
  } | null;
  /** 3차 별지 현장확인(③-2b): 별지코드 → 확인 스냅샷 */
  deptConfirmations?: Record<string, {
    dept?: string; by?: string; name?: string | null; signature?: string; at?: string; mode?: string; reason?: string | null;
  }> | null;
  /** TBM 디지털 상세 + 참여자 확인 스탬프 */
  tbmExtra?: {
    workContent?: string | null;
    riskFactors?: string[];
    safetyMeasures?: string[];
    teamLeaderSignature?: string | null;
    safetyManager?: { name: string | null; signature: string | null; company?: string | null } | null;
    /** 참여자 확인: key(name||normPhone) → { name, signature, confirmedAt } */
    confirmations?: Record<string, { name: string; signature: string; confirmedAt: string }>;
  } | null;
  /** TBM 현장 사진(Storage에서 라우트가 해석한 base64 data URL) */
  tbmPhotos?: string[];
  /** 시트2 QR(허가번호+검증 URL) — 라우트가 생성한 PNG data URL */
  qrDataUrl?: string | null;
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

/** 셀 주소 → 0-indexed {col,row} (A=0, 1행=0) */
function anchorColRow(addr: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(addr);
  if (!m) return { col: 0, row: 0 };
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: parseInt(m[2], 10) - 1 };
}

/** 디지털 서명/사진/QR 이미지를 특정 셀 기준으로 앉힘(병합·셀값 불변, 위에 오버레이). */
function placeImage(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  dataUrl: string | null | undefined,
  addr: string,
  w: number,
  h: number,
  dx = 0,
  dy = 0
) {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return;
  const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
  if (!m) return;
  try {
    const ext = (m[1] === 'jpg' ? 'jpeg' : m[1]) as 'png' | 'jpeg' | 'gif';
    const imageId = wb.addImage({ base64: m[2], extension: ext });
    const { col, row } = anchorColRow(addr);
    ws.addImage(imageId, {
      tl: { col: col + dx, row: row + dy },
      ext: { width: w, height: h },
    } as any);
  } catch (e) {
    console.error('[placeImage] failed:', addr, e);
  }
}

// ===== R-6 ③-4: 서명 아래 로그(이름 · MM-DD HH:MM) — @napi-rs/canvas 지연로딩·fail-safe =====
let _createCanvas: ((w: number, h: number) => any) | null = null;
let _canvasReady = false;
async function ensureCanvas() {
  if (_canvasReady) return;
  _canvasReady = true;
  try {
    const m: any = await import('@napi-rs/canvas');
    _createCanvas = m.createCanvas;
  } catch {
    _createCanvas = null; // 라이브러리 없으면 로그만 생략(양식 정상 출력)
  }
}
function fmtLogTime(iso?: string | null): string {
  if (!iso) return '';
  const k = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}
/** 로그 PNG(투명·흐린회색 8pt·오른쪽정렬) base64. 실패 시 null. */
function renderLogPng(text: string, widthPx: number): string | null {
  if (!_createCanvas || !text) return null;
  try {
    const scale = 3;
    const W = Math.max(40, Math.round(widthPx));
    const H = 11;
    const c = _createCanvas(W * scale, H * scale);
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    ctx.font = '8px sans-serif';
    ctx.fillStyle = 'rgba(110,110,110,0.72)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(text, W - 1, H - 1);
    return c.toBuffer('image/png').toString('base64');
  } catch {
    return null;
  }
}
/** 서명칸(addr, 폭 sigW) 오른쪽 아래에 서명자·시각 로그 배치(서명 그림 침범 최소화). */
function placeSigLog(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  addr: string,
  label: string | null | undefined,
  at: string | null | undefined,
  sigW: number
) {
  const text = [label, fmtLogTime(at)].filter(Boolean).join(' · ').trim();
  if (!text) return;
  const b64 = renderLogPng(text, sigW);
  if (!b64) return;
  try {
    const id = wb.addImage({ base64: b64, extension: 'png' });
    const { col, row } = anchorColRow(addr);
    ws.addImage(id, { tl: { col: col + 0.02, row: row + 0.62 }, ext: { width: sigW, height: 11 } } as any);
  } catch {
    /* 로그 실패 무시 */
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

  // 하단 서약블록(A24:D25): 서명일 + 소속(업체명) + 서약자(성명) 자동 표기
  {
    const cell = ws.getCell('A24');
    let raw = typeof cell.value === 'string' ? cell.value : String(cell.value ?? '');
    if (p.workDate) {
      const k = toKST(p.workDate);
      raw = raw.replace(/20\s+년\s+월\s+일/, `${k.getUTCFullYear()}년 ${pad(k.getUTCMonth() + 1)}월 ${pad(k.getUTCDate())}일`);
    }
    raw = raw.replace(/소속:\s*/, `소속: ${p.companyName ?? ''}          `);
    raw = raw.replace(/서약자:\s*$/, `서약자: ${p.name}`);
    cell.value = raw;
  }

  // 디지털 서명 — 전용 칸(E24:F25)
  placeImage(wb, ws, p.signature, 'E24', 110, 28, 0.2, 0.5);
}

/** 이행각서 1장 채움 (참여인원 서명 = 서약 서명 재사용, 현장소장 = 신청인 서명) */
function fillUndertakingSheet(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  u: NonNullable<DocsOutput['undertaking']>,
  sigByName: Map<string, string>,
  signer?: { name?: string | null; signature?: string | null; date?: string | null },
  workDateIso?: string
) {
  const C = DOC_CELLS.undertaking;
  ws.getCell(C.company).value = `◎ 소속사명 : ${u.companyName ?? ''}`;
  ws.getCell(C.area).value = `◎ 작업구역 : ${u.workArea ?? ''}`;
  // R-6 ⓒ: 출입기간 = 작업일 당일 (각서 유효기간 6개월과 무관하게, 이 허가건의 출입은 당일)
  const period = workDateIso
    ? `${fmtDate(workDateIso)} (당일)`
    : u.issuedAt && u.expiresAt
      ? `${fmtDate(u.issuedAt)} ~ ${fmtDate(u.expiresAt)}`
      : '';
  ws.getCell(C.period).value = `◎ 출입기간 : ${period}`;
  ws.getCell(C.manager).value = `◎ 관리감독자 : ${u.managerName ?? ''}        연락처 : ${u.managerPhone ?? ''}`;
  const cap = C.memberRowEnd - C.memberRowStart + 1; // 10
  u.members.slice(0, cap).forEach((m, i) => {
    const r = C.memberRowStart + i;
    ws.getCell(`B${r}`).value = m.name ?? '';
    ws.getCell(`C${r}`).value = birthFront(m.birthDate);
    ws.getCell(`D${r}`).value = m.phone ?? '';
    // 서명 E: 서약 서명 재사용(있으면), 없으면 공란. 비고 F 빈칸.
    const sig = sigByName.get((m.name ?? '').trim());
    if (sig) placeImage(wb, ws, sig, `E${r}`, 70, 18, 0.05, 0.1);
  });
  // 대표/현장소장(A29:F30): 날짜 자동 표기 + 신청인(=업체 현장소장) 성명·서명 연동
  {
    const cell = ws.getCell('A29');
    let raw = typeof cell.value === 'string' ? cell.value : String(cell.value ?? '');
    if (signer?.date) {
      const k = toKST(signer.date);
      raw = raw.replace(
        /20\s+년\s+월\s+일/,
        `${k.getUTCFullYear()}년 ${pad(k.getUTCMonth() + 1)}월 ${pad(k.getUTCDate())}일`
      );
    }
    raw = raw.replace(/현장소장:\s*$/, `현장소장: ${signer?.name ?? ''}`);
    cell.value = raw;
  }
  // 현장소장 서명 — 전용 칸(E29:F30, '(인)' 고스트 위)
  placeImage(wb, ws, signer?.signature, 'E29', 100, 26, 0.25, 0.5);
}

/** 교육결과서 1장 채움 (대상자 서명 = 서약 서명 재사용, 실시자 = TBM 실시자) */
function fillEduSheet(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  e: DocsOutput['eduResult'],
  sigByName: Map<string, string>,
  instructor?: { name?: string | null; signature?: string | null }
) {
  const C = DOC_CELLS.edu;
  ws.getCell(C.datetime).value = `1. 교육 일시 : ${e.date ? fmtDate(e.date) : ''}`;
  ws.getCell(C.content).value = `2. 교육 내용 : ${e.content ?? ''}`;
  const leftCap = C.leftRowEnd - C.leftRowStart + 1; // 24
  e.names.forEach((nm, i) => {
    const sig = sigByName.get((nm ?? '').trim());
    if (i < leftCap) {
      const r = C.leftRowStart + i;
      ws.getCell(`B${r}`).value = nm;
      if (sig) placeImage(wb, ws, sig, `C${r}`, 60, 16, 0.05, 0.1); // 서명 C
    } else {
      const idx = i - leftCap;
      if (idx < (C.rightRowEnd - C.rightRowStart + 1)) {
        const r = C.rightRowStart + idx;
        ws.getCell(`E${r}`).value = nm;
        if (sig) placeImage(wb, ws, sig, `F${r}`, 60, 16, 0.05, 0.1); // 서명 F
      }
    }
  });
  // 교육 실시자 = TBM 실시자 — 텍스트 A32:C32 + 서명칸 D32:F32
  if (instructor?.name) {
    const cell = ws.getCell('A32');
    cell.value = `교육 실시자              성명: ${instructor.name}`;
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: false, shrinkToFit: true };
    placeImage(wb, ws, instructor.signature, 'D32', 80, 18, 0.3, 0.1);
  }
}

/** 필수문서 시트 채움: 개인서약 N장(시트 복제) + 이행각서 1장 + 교육결과서 1장 */
function fillDocSheets(wb: ExcelJS.Workbook, docs: DocsOutput, data: PermitDocData) {
  // 이름 → 서약 서명 맵(교육결과서·이행각서 서명 재사용용)
  const sigByName = new Map<string, string>();
  for (const p of docs.pledges) {
    if (p.signature && p.signature.startsWith('data:image/')) {
      sigByName.set((p.name ?? '').trim(), p.signature);
    }
  }
  // 개인서약: **미기입 원본을 먼저 N-1장 복제한 뒤** 각 장을 채운다.
  //  - 기입 후 복제하면 A24 서명블록(서명일·소속·서약자)이 첫 참여자로 고정되는 버그(R-6 ⓔ)
  //  - 템플릿(v5 클린)에서 서약 시트가 맨 뒤(각서 다음)라 복제본이 끝에 붙어도
  //    서약끼리 연속 배치된다(R-6 ⓑ: 각서 | 서약(1) | 서약(2) | …)
  const pledgeSrc = wb.getWorksheet(SHEET_PLEDGE);
  if (pledgeSrc && docs.pledges.length > 0) {
    const pledgeSheets: ExcelJS.Worksheet[] = [pledgeSrc];
    for (let i = 1; i < docs.pledges.length; i++) {
      pledgeSheets.push(cloneWorksheet(wb, pledgeSrc, `${SHEET_PLEDGE}(${i + 1})`));
    }
    pledgeSrc.name = `${SHEET_PLEDGE}(1)`;
    pledgeSheets.forEach((sheet, i) => fillPledgeSheet(wb, sheet, docs.pledges[i]));
  }
  // 이행각서 — 현장소장 = 신청인(업체 현장소장) 서명·날짜, 출입기간 = 작업일 당일(ⓒ)
  const us = wb.getWorksheet(SHEET_UNDERTAKING);
  if (us && docs.undertaking) {
    fillUndertakingSheet(
      wb,
      us,
      docs.undertaking,
      sigByName,
      {
        name: data.info.applicantName,
        signature: data.applicantSignature,
        date: data.createdAt,
      },
      data.info.workStart
    );
  }
  // 교육결과서 — 실시자 = TBM 실시자(신청인)
  const es = wb.getWorksheet(SHEET_EDU);
  if (es) {
    fillEduSheet(wb, es, docs.eduResult, sigByName, {
      name: data.info.applicantName,
      signature: data.tbmExtra?.teamLeaderSignature ?? data.applicantSignature,
    });
  }
}

/** 1C-3 보충작업 별지: 종류별 시트 공통 헤더 채움 + 신청인 서명 + 작업완료 연동. 부서 확인자는 미연동(현장/앱). */
function fillSupplementalHeader(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  t: WorkTypeDef,
  data: PermitDocData
) {
  const cells = t.cells;
  const info = data.info;
  const title = (info.applicantTitle ?? '').trim();
  setCell(ws, cells.permitNumber, data.permitNumber);
  setCell(ws, cells.permitDate, fmtDate(data.createdAt));
  setCell(ws, cells.applicant, `직책: ${title}    성명: ${info.applicantName}`);
  // 신청인 서명 — 전용 칸(H:I)
  const appRow = cells.applicant.replace(/[A-Z]+/, '');
  placeImage(wb, ws, data.applicantSignature, `H${appRow}`, 84, 20, 0.1, 0.05);
  if (data.applicantSignature) placeSigLog(wb, ws, `H${appRow}`, info.applicantName, data.createdAt, 84);
  setCell(ws, cells.period, `${fmtDateTime(info.workStart)} ~ ${fmtTime(info.workEnd)} (당일)`);
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

  // R-6: 작업완료 확인 — 마스터와 동일하게 완료시간 + 작업자(신청인) + 작업자 서명 자동채움.
  //  (부서 확인자 서명은 부서확인 연동 전까지 칸 그대로.)
  const comp = data.completion;
  if (comp && (comp.completedAt || comp.workerSignature)) {
    if (comp.completedAt) {
      setCell(ws, t.done.info, `완료시간: ${fmtDateTime(comp.completedAt)}    작업자: ${info.applicantName}`);
    }
    placeImage(wb, ws, comp.workerSignature ?? data.applicantSignature, t.done.workerSig, 72, 18, 0.05, 0.1);
    if (comp.workerSignature ?? data.applicantSignature) placeSigLog(wb, ws, t.done.workerSig, info.applicantName, comp.completedAt, 72);
  }
  // 별지 종료확인(확인자) = 완료행 바로 아래 (E{r+1} 라벨 / I{r+1} 서명). 마스터 E38/I38 과 동일 데이터.
  if (comp?.confirmSignature) {
    const doneRow = parseInt(t.done.workerSig.replace(/[A-Z]+/, ''), 10);
    const cLabelCell = `E${doneRow + 1}`;
    const cSigCell = `I${doneRow + 1}`;
    setCell(ws, cLabelCell, `확인자: ${comp.confirmBy ?? ''}`);
    placeImage(wb, ws, comp.confirmSignature, cSigCell, 72, 18, 0.05, 0.1);
    placeSigLog(wb, ws, cSigCell, comp.confirmBy, comp.confirmAt, 72);
  }
  // R-6 ③-2b: 3차 현장확인 → 별지 "관련부서(해당 시)" 행. 긴급대리는 공무 서명인 척 금지(명시 라벨).
  const dc = data.deptConfirmations?.[t.key];
  if (dc?.signature) {
    const label =
      dc.mode === 'EMERGENCY_PROXY'
        ? `관련부서(공무 미배정) · 안전환경 긴급대리${dc.reason ? ` (사유: ${dc.reason})` : ''}`
        : `관련부서(${dc.dept ?? ''})   ${dc.name ?? ''}`.trimEnd();
    setCell(ws, t.confirm.label, label, true);
    placeImage(wb, ws, dc.signature, t.confirm.sig, 76, 18, 0.05, 0.1);
    placeSigLog(wb, ws, t.confirm.sig, dc.mode === 'EMERGENCY_PROXY' ? '긴급대리' : (dc.name || dc.dept), dc.at, 76);
  }
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
      fillSupplementalHeader(wb, ws, t, data);
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
  await ensureCanvas(); // ③-4: 서명 로그 렌더러 준비(없어도 진행)
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
  // 신청인: 직책/성명 (실서명 이미지가 옆칸 H3에 들어가므로 "(서명)" 프리필 글자 제거)
  const title = (info.applicantTitle ?? '').trim();
  setCell(gs, G.applicant, `직책: ${title}    성명: ${info.applicantName}`);
  // 허가기간: 시작 전체 ~ 종료 시각 — 당일 원칙 명시
  setCell(
    gs,
    G.period,
    `${fmtDateTime(info.workStart)} ~ ${fmtTime(info.workEnd)} (당일)`
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

  // ===== R-6 시트2 결재란: 서명 = 전용 칸 (텍스트부와 분리) =====
  // 신청인: 텍스트 B3:G3 + 서명칸 H3:I3
  placeImage(wb, gs, data.applicantSignature, 'H3', 84, 20, 0.1, 0.05);
  if (data.applicantSignature) placeSigLog(wb, gs, 'H3', info.applicantName, data.createdAt, 84);
  // A37 승인자(요청부서 현장책임자) — 부서/직책 + 성명만. 서명칸 D37은 gate ③.
  // (승인 방식 SITE/REMOTE 는 DB에만 기록, 출력물엔 표기하지 않음 — 사용자 지시 2026-07-08)
  if (data.approval?.name || data.approval?.title) {
    setCell(gs, 'A37', `승인자(요청부서 현장책임자)   ${data.approval?.title ?? ''}  ${data.approval?.name ?? ''}`);
    placeImage(wb, gs, data.approval?.signature, 'D37', 76, 18, 0.05, 0.1);
    if (data.approval?.signature) placeSigLog(wb, gs, 'D37', data.approval?.name, data.approval?.at, 76);
  }
  // A38 발급자(안전환경담당) — 서명칸 D38, gate ③
  if (data.issuer?.name) {
    setCell(gs, 'A38', `발급자(안전환경담당)   성명: ${data.issuer.name}`);
    placeImage(wb, gs, data.issuer.signature, 'D38', 76, 18, 0.05, 0.1);
    if (data.issuer.signature) placeSigLog(wb, gs, 'D38', data.issuer.name, data.issuer.at, 76);
  }
  // A39 입회자(안전환경 현장입회, 2차) — 서명칸 D39, gate ③-2a
  if (data.witness?.signature || data.witness?.name) {
    setCell(gs, 'A39', `입회자(안전환경담당)   성명: ${data.witness?.name ?? ''}`);
    placeImage(wb, gs, data.witness?.signature, 'D39', 76, 18, 0.05, 0.1);
    if (data.witness?.signature) placeSigLog(wb, gs, 'D39', data.witness?.name, data.witness?.at, 76);
  }
  // 오늘의 안전지시사항(입회 2차 입력) → 기타 특별사항(A35)
  if (data.safetyInstructions) {
    setCell(gs, G.etc, `오늘의 안전지시사항: ${data.safetyInstructions}`, true);
  }
  // A40 관련부서 협조자 = '(해당 시)' — 데이터 없음, 서명칸 공란 유지
  // E37 완료시간+작업자(서명칸 I37) / E38 확인자+복원상태(서명칸 I38) — gate ③
  const comp = data.completion;
  if (comp && (comp.completedAt || comp.workerSignature || comp.restoreState)) {
    // 작업완료 수행 주체 = 신청인 → '작업자:' 옆에 신청인 성명 표기(서명은 I37)
    if (comp.completedAt) {
      setCell(gs, 'E37', `완료시간: ${fmtDateTime(comp.completedAt)}    작업자: ${data.info.applicantName}`);
    }
    placeImage(wb, gs, comp.workerSignature, 'I37', 72, 18, 0.05, 0.1);
    if (comp.workerSignature) placeSigLog(wb, gs, 'I37', data.info.applicantName, comp.completedAt, 72);
    // E38 확인자 = 종료확인(안전환경 최종, ③-2b). 없으면 공란.
    if (comp.confirmSignature) {
      setCell(gs, 'E38', `확인자(안전환경): ${comp.confirmBy ?? ''}`);
      placeImage(wb, gs, comp.confirmSignature, 'I38', 72, 18, 0.05, 0.1);
      placeSigLog(wb, gs, 'I38', comp.confirmBy, comp.confirmAt, 72);
    }
    // 복원상태·입회 특이사항 → 특이사항 칸(G39:I40)
    const etcNotes: string[] = [];
    if (comp.restoreState) etcNotes.push(`복원(조치)상태: ${comp.restoreState}`);
    if (comp.witnessName) etcNotes.push(`입회: ${comp.witnessName}`);
    if (etcNotes.length > 0) setCell(gs, 'G39', etcNotes.join(' / '), true);
  }
  // A41 작업허가 연장 — 텍스트 A41:H41 + 서명칸 I41 (연장 데이터는 현장 수기)
  // QR(허가번호+검증 URL) — 우상단 모서리(허가일자 값 가림 방지: I열 우측 끝)
  placeImage(wb, gs, data.qrDataUrl, 'I1', 46, 46, 0.35, 0.05);

  // ===== TBM (R-6 개정: 2줄 헤더 — 작업업체/현장소장·안전담당 + 안전관리자 소속/성명) =====
  setCell(ts, T.datetime, fmtDateTime(info.workStart));
  setCell(ts, T.place, info.workLocation);
  setCell(ts, T.workName, info.workName);
  setCell(ts, T.company, data.companyName); // 작업업체(자동)

  const te = data.tbmExtra;
  // 현장소장/안전담당 = 신청인. 서명은 전용 칸(D6).
  setCell(ts, T.leaderName, info.applicantName);
  placeImage(wb, ts, te?.teamLeaderSignature ?? data.applicantSignature, T.leaderSig, 74, 20, 0.1, 0.05);
  if (te?.teamLeaderSignature ?? data.applicantSignature) placeSigLog(wb, ts, T.leaderSig, info.applicantName, data.createdAt, 74);
  // 안전관리자(사내 확인·결재) — 성명(G6) + 서명칸(I6). 소속(G5)은 "동남" 프리필 유지.
  // 버그2 A안(③-4): 안전관리자 = 안전환경(TBM 확인자) → 2차(입회) 서명을 재사용.
  //  구 신청폼 안전관리자 입력(sm)이 있으면 우선, 없으면 witness(2차) 서명·"안전환경".
  const sm = te?.safetyManager;
  const smSig = sm?.signature ?? data.witness?.signature ?? null;
  const smName = sm?.name ?? (smSig ? '안전환경' : null);
  if (smName) setCell(ts, T.smName, smName);
  if (smSig) {
    placeImage(wb, ts, smSig, T.smSig, 74, 20, 0.1, 0.05);
    // 안전관리자 = 안전환경(2차 입회) → 로그도 입회 시각·라벨 사용
    placeSigLog(wb, ts, T.smSig, smName, data.witness?.at, 74);
  }
  // ▶ 작업내용(행 9~14에 줄 단위 분배: 잘림 방지) / 위험요인 / 안전대책
  const rs = T.contentRowStart;
  if (te?.workContent) {
    const words = te.workContent.replace(/\s+/g, ' ').trim();
    const lines: string[] = [];
    for (let s = 0; s < words.length && lines.length < 6; s += 11) {
      lines.push(words.slice(s, s + 11));
    }
    lines.forEach((ln, i) => setCell(ts, `B${rs + i}`, ln));
  }
  (te?.riskFactors ?? []).slice(0, 6).forEach((rf, i) => setCell(ts, `D${rs + i}`, rf));
  (te?.safetyMeasures ?? []).slice(0, 6).forEach((mz, i) => setCell(ts, `F${rs + i}`, mz));
  // 참여자 확인 스탬프 맵 (name → {signature, confirmedAt})
  const confByName = new Map<string, { signature: string; confirmedAt?: string }>();
  for (const c of Object.values(te?.confirmations ?? {})) {
    if (c?.signature && c.signature.startsWith('data:image/')) {
      confByName.set((c.name ?? '').trim(), { signature: c.signature, confirmedAt: c.confirmedAt });
    }
  }

  // 참석자 그리드 — 좌12·우12 (서명 = 참여자 확인 스탬프, 미확인 공란)
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
    // 서명 D/I = 참여자 확인 스탬프(있으면), 미확인 공란
    const conf = confByName.get((p.name ?? '').trim());
    if (conf) {
      const cell = `${left ? 'D' : 'I'}${r}`;
      placeImage(wb, ts, conf.signature, cell, 55, 16, 0.05, 0.1);
      placeSigLog(wb, ts, cell, p.name, conf.confirmedAt, 55);
    }
  });

  // ----- R-6 TBM 실시 사진 → 별지 '1-2_TBM현장사진' (대형 2칸) -----
  // 사용자 확정(2026-07-08): 사진이 없어도 시트는 **무조건 포함**(빈 칸으로 출력 → 현장 부착).
  const PC = TEMPLATE_CELLS.tbmPhoto;
  const tbmPhotosArr = (data.tbmPhotos ?? []).slice(0, PC.maxPhotos);
  const photoSheet = wb.getWorksheet(SHEET_TBM_PHOTO);
  if (photoSheet) {
    setCell(photoSheet, PC.datetime, fmtDateTime(info.workStart));
    setCell(photoSheet, PC.place, info.workLocation);
    // 16:9 크롭된 사진 → 칸 높이에 맞춰 372×210 (왜곡 없음). 없으면 빈 칸 그대로.
    tbmPhotosArr.forEach((ph, i) => {
      placeImage(wb, photoSheet, ph, PC.anchors[i], 372, 210, 0.85, 0.2);
    });
  }

  // 기타 특별사항: note + 참여자 초과분
  const etcParts: string[] = [];
  if (data.note && data.note.trim()) etcParts.push(data.note.trim());
  if (overflow.length > 0) etcParts.push(`추가 참여자: ${overflow.join(', ')}`);
  if (etcParts.length > 0) {
    setCell(gs, G.etc, etcParts.join(' / '), true);
  }

  // ===== 1C-2 필수문서(있으면 채움) =====
  if (data.docs) {
    fillDocSheets(wb, data.docs, data);
  }

  // ===== 1C-3 보충작업 별지(체크분만 헤더 채움 + 미체크 시트 제거) =====
  applySupplementalSheets(wb, data);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export const __fmt = { fmtDate, fmtDateTime, fmtTime }; // 테스트/재사용
