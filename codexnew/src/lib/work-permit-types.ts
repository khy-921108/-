/**
 * 1C-3 보충작업 별지 레지스트리 — 보충작업 종류별 "빈 허가서" 시트의 공통 헤더 셀 매핑.
 *
 * 배경(템플릿 work-permit-template.xlsx 실측):
 *  - 템플릿(work-permit-template.xlsx)에는 7종 작업허가서 시트가 **이미 포함**되어 있다.
 *    → 출력 시 체크(Y)된 종류만 헤더를 채우고, 미체크 종류 시트는 출력에서 제거한다.
 *  - 6개 시트(화기·밀폐·고소·굴착·중장비·방사선)는 상단 ★주의문(2행)이 있어 동일한
 *    "표준 레이아웃": 허가번호=B3 / 허가일자=G3 / 신청인=B4 / 허가기간=B5 /
 *    작업장소및설비=A7(멀티라인) / 작업개요=C7(멀티라인).
 *  - **5_정전작업허가서만** ★주의문 행이 없어 전체가 1행 위로 shift:
 *    허가번호=B2 / 허가일자=G2 / 신청인=B3 / 허가기간=B4 / 작업장소=A6 / 작업개요=C6.
 *
 * 규칙: **공통 헤더(anchor 셀)만** 자동 채움. 종류별 안전조치·측정·관련작업허가 체크·
 *       모든 서명은 양식 그대로 빈칸(현장 수기). 체크리스트 상수는 두지 않는다(표시 전용 양식).
 */

import type { SupplementalKey } from './work-permit-constants';

export interface WorkTypeHeaderCells {
  permitNumber: string; // 허가번호 값 anchor (병합셀 좌상단)
  permitDate: string;   // 허가일자 값 anchor
  applicant: string;    // 신청인 값 anchor (프리필 '직책: 성명: (서명)')
  period: string;       // 허가기간 값 anchor (프리필 '20 년 …')
  location: string;     // 작업장소 및 설비 값 anchor (멀티라인 프리필)
  overview: string;     // 작 업 개 요 값 anchor (멀티라인)
}

export interface WorkTypeDef {
  key: SupplementalKey;
  label: string;   // 보충작업 라벨(시트 식별/표시용) — SUPPLEMENTAL_WORKS 와 동일
  sheet: string;   // 템플릿 시트명(정확히 일치)
  cells: WorkTypeHeaderCells;
}

/** 표준 레이아웃(★주의문 2행 존재) — 6개 시트 공통 */
const STD: WorkTypeHeaderCells = {
  permitNumber: 'B3',
  permitDate: 'G3',
  applicant: 'B4',
  period: 'B5',
  location: 'A7',
  overview: 'C7',
};

/** 정전 전용(★주의문 행 없음 → 1행 위 shift) */
const SHIFTED: WorkTypeHeaderCells = {
  permitNumber: 'B2',
  permitDate: 'G2',
  applicant: 'B3',
  period: 'B4',
  location: 'A6',
  overview: 'C6',
};

export const WORK_TYPES: WorkTypeDef[] = [
  { key: 'hot',        label: '화기',     sheet: '3_화기작업허가서',     cells: STD },
  { key: 'confined',   label: '밀폐공간', sheet: '4_밀폐공간출입허가서', cells: STD },
  { key: 'electric',   label: '정전',     sheet: '5_정전작업허가서',     cells: SHIFTED },
  { key: 'height',     label: '고소',     sheet: '6_고소작업허가서',     cells: STD },
  { key: 'excavation', label: '굴착',     sheet: '7a_굴착작업허가서',    cells: STD },
  { key: 'heavy',      label: '중장비',   sheet: '7b_중장비작업허가서',  cells: STD },
  { key: 'radiation',  label: '방사선',   sheet: '7c_방사선작업허가서',  cells: STD },
];

/** 보충작업(Y) 체크된 종류만 필터 — 출력 순서는 WORK_TYPES 정의순 */
export function workTypesFor(
  supplemental: Record<string, 'Y' | 'N' | undefined> | null | undefined
): WorkTypeDef[] {
  return WORK_TYPES.filter((t) => supplemental?.[t.key] === 'Y');
}
