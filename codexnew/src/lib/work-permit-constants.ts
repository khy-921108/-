/**
 * 작업허가서(1C-1) 상수 — 코드·라벨은 이 파일에서만 관리.
 *
 * - SUPPLEMENTAL_WORKS: 보충작업 7종. 앱이 채우는 **유일한 체크**(해당/비해당).
 *   양식의 E6/E7/E8 셀에 여러 □가 묶여 있어, 각 종류의 라벨 토큰을 기준으로 □→■ 치환.
 * - GENERAL_SAFETY_MEASURES: 안전조치 16항목 — **표시 전용**(HTML 빈 체크 그리드 라벨).
 *   1C-1은 앱 입력 없음. xlsx 양식엔 이미 인쇄돼 있어 건드리지 않음.
 * - TBM_CHECKLIST: 작업 전 점검 8항목 — 표시 전용(양식 빈칸, 현장).
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
  /** 양식 시트 '2_일반위험작업허가서'에서 이 종류 □가 들어있는 셀(anchor) */
  cell: 'E6' | 'E7' | 'E8';
  /** 셀 안에서 이 종류를 식별하는 라벨 토큰(□ 바로 뒤 텍스트). 치환 기준. */
  token: string;
}

/**
 * 양식 실측(E6/E7/E8) 기준:
 *   E6 = "□ 밀폐공간  □ 고소"
 *   E7 = "□ 정전  □ 굴착  □ 화기"
 *   E8 = "□ 중장비  □ 방사선"
 */
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
