/**
 * 작업허가서(1C-1) 상수 — 코드·라벨은 이 파일에서만 관리.
 */

export type SupplementalKey =
  | 'confined'
  | 'height'
  | 'electric'
  | 'excavation'
  | 'hot'
  | 'heavy'
  | 'radiation';

export interface SupplementalWork {
  key: SupplementalKey;
  label: string;
  cell: 'E6' | 'E7' | 'E8';
  token: string;
}

export const SUPPLEMENTAL_WORKS: SupplementalWork[] = [
  { key: 'confined', label: '밀폐공간', cell: 'E6', token: '밀폐공간' },
  { key: 'height', label: '고소', cell: 'E6', token: '고소' },
  { key: 'electric', label: '정전', cell: 'E7', token: '정전' },
  { key: 'excavation', label: '굴착', cell: 'E7', token: '굴착' },
  { key: 'hot', label: '화기', cell: 'E7', token: '화기' },
  { key: 'heavy', label: '중장비', cell: 'E8', token: '중장비' },
  { key: 'radiation', label: '방사선', cell: 'E8', token: '방사선' },
];

export const SUPPLEMENTAL_KEYS: SupplementalKey[] = SUPPLEMENTAL_WORKS.map((s) => s.key);

export function supplementalLabel(key: string): string {
  return SUPPLEMENTAL_WORKS.find((s) => s.key === key)?.label ?? key;
}

export function isSupplementalKey(v: unknown): v is SupplementalKey {
  return typeof v === 'string' && SUPPLEMENTAL_KEYS.includes(v as SupplementalKey);
}

/** 안전조치 16항목 — HTML 표시 전용(빈 체크 그리드). 좌 8 / 우 8. */
export const GENERAL_SAFETY_MEASURES: { side: 'L' | 'R'; label: string }[] = [
  { side: 'L', label: '작업구역 설정 (출입경고 표지 등)' },
  { side: 'L', label: '위험에너지 차단 및 LOTO 실시' },
  { side: 'L', label: '밸브차단 및 차단표지 부착 (도면 비교)' },
  { side: 'L', label: '맹판설치 및 표지부착 (도면 비교)' },
  { side: 'L', label: '용기개방 및 압력방출' },
  { side: 'L', label: '위험물질 (가연성분 포함) 방출 및 처리' },
  { side: 'L', label: '용기내부 세정 및 처리' },
  { side: 'L', label: '불활성가스 치환 및 환기' },
  { side: 'R', label: '소화기 비치 (적응성 고려, 1대 이상)' },
  { side: 'R', label: '안전보건 교육 및 비상대피정보 제공' },
  { side: 'R', label: '작업자의 건강 상태 확인' },
  { side: 'R', label: '작업자 복장 및 적정 보호구 착용' },
  { side: 'R', label: '정전 / 잠금 / 표지부착 (LOTO)' },
  { side: 'R', label: '환기장비 / 조명장비' },
  { side: 'R', label: '안전장구 (구명전등 등)' },
  { side: 'R', label: '운전요원 입회 / 보안요원 배치' },
];

/** 작업 전 점검 8항목 — 표시 전용(양식 빈칸, 현장). */
export const TBM_CHECKLIST: string[] = [
  '개인보호구 (안전모, 안전화, 안전대, 보안경 등) 착용 확인',
  '작업허가서 발급 및 현장 게시 확인',
  '가스농도 측정 실시 (밀폐공간·화기작업 시)',
  '작업 구역 출입통제 표지 설치 확인',
  '소화기 비치 여부 확인 (화기작업 시)',
  '공구·장비 점검 (결함 여부 확인)',
  '폭염·한파 대비 조치 확인',
  '비상연락망 및 구급함 위치 확인',
];

// ===== 1C-2 서약/각서 조항 (발급 전 내용 확인용 — 회사 양식과 동일 문구) =====
export const PLEDGE_INTRO =
  '상기 본인은 ㈜동남 울산공장 내 현장에서 작업 중 아래 명기되어 있는 근로자 준수사항을 숙지하고, 산업안전보건법 및 중대재해처벌법에 의한 안전규정, 수칙 및 현장 안전관리 제반규정을 준수하며, 불이행 시 어떠한 민형사상의 처벌도 감수할 것을 서약합니다.';

export const PLEDGE_CLAUSES: string[] = [
  '현장 내에서는 규정된 복장 및 안전보호구(안전모, 안전화, 안전대 등)를 정확하게 착용하고 작업한다.',
  '현장의 제반 규정과 규칙을 준수하여 안전사고 예방에 적극 협조한다.',
  '공장 내에서는 금연이며 지정된 장소에서만 흡연한다.',
  '2m 이상 고소작업 시에는 안전대를 반드시 착용하고 작업한다.',
  '위험표시 구역은 담당자 외 무단 출입을 금지한다.',
  '유해위험기계기구 및 전동공구는 관리자 허가 후 사용하며, 변칙 사용을 금지한다.',
  '각종 기계기구 안전장치 및 위험장소 안전시설을 해체·파손하지 않는다.',
  '모든 전선은 전기가 통한다고 생각하고 허가 없이 사용을 금지한다.',
  '음주 후에는 절대 작업하지 않는다.',
  '현장 내 정리정돈을 습관화한다.',
  '현장 내에서 작업 전 안전교육(TBM 포함)을 반드시 이수한다.',
  '폭염(체감온도 33℃↑ 시 2시간마다 20분↑ 휴식) 및 한파 시 사업주 조치에 따른다.',
  '기타 안전사고 예방에 적극 협조한다.',
];

export const UNDERTAKING_INTRO =
  '상기인들은 ㈜동남 울산공장에서 작업함에 있어 회사의 규정을 철저히 준수할 것이며, 만약 아래 사항을 이행하지 않을 경우 어떠한 제재 조치도 감수할 것과 그에 따른 사고 발생 시 민·형사상 전반의 책임을 감수하겠음을 이에 서약합니다.';

export const UNDERTAKING_CLAUSES: string[] = [
  '당사의 휴게시간 및 작업장 금연 규칙 등 기본 근무질서사항 준수',
  '안전 복장 및 안전 보호구 착용 철저 준수',
  '자체 안전 교육(TBM 포함) 실시 및 결과서 제출',
  "당사의 '안전준수 서약' 내용을 반드시 준수",
  '임의로 작업구역을 벗어나지 않으며 작업완료 시 담당자 확인 후 이동',
  '위험작업(고소, 밀폐, 야간 등) 발생 시 위험작업 신고 실시',
  '중대재해처벌법 제4조에 따른 경영책임자 안전보건관리체계 이행',
];
