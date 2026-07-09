/**
 * R-6 작업허가 진행단계(뱃지) 공용 판정 — 관리자 목록·상세헤더·업체조회 3곳 일관.
 *
 * ⚠️ work_permits.status 컬럼은 SHE 포털 브리지(R-2 승인/반려)와 R-6 이 공유하므로
 *    "작업개시" 판정에 status='APPROVED' 를 쓰면 포털 승인만으로 오표시됨.
 *    → 진행단계는 실제 R-6 서명/확인 데이터로 계산한다. "작업개시"는 오직 started_at(작업개시 승인 성공)일 때만.
 *    (status 는 'REJECTED' 반려 표시에만 참고)
 *
 * 단계(사용자 확정):
 *  대기 → 현장확인 필요(1차 발급 후) → 2차 승인 대기(업체 TBM 완료) →
 *  3차 확인 필요(2차 후, 별지 있음) / 작업개시 가능(별지 없거나 3차 완료) →
 *  작업개시(start_work 성공) → 작업종료(종료확인)
 */

export type StageKey =
  | 'WAITING'       // 대기
  | 'SITE_CHECK'    // 현장확인 필요
  | 'WITNESS_WAIT'  // 2차 승인 대기
  | 'THIRD_CHECK'   // 3차 확인 필요
  | 'START_READY'   // 작업개시 가능
  | 'IN_PROGRESS'   // 승인 진행중 (목록 경량뱃지 — 중간단계 통합)
  | 'STARTED'       // 작업개시
  | 'CLOSED'        // 작업종료
  | 'REJECTED';     // 반려

export interface StageInput {
  status?: string | null;
  issuerSignature?: string | null;
  witnessSignature?: string | null;
  photoCount?: number;
  workerConfirmCount?: number;
  supplemental?: Record<string, string> | null;
  deptConfirmations?: Record<string, { signature?: string | null } | undefined> | null;
  startedAt?: string | null;
  completionConfirmed?: boolean;
}

export interface Stage { key: StageKey; label: string }

const isSig = (s?: string | null): boolean => !!(s && String(s).startsWith('data:image/'));

export function computeStage(i: StageInput): Stage {
  if (i.completionConfirmed) return { key: 'CLOSED', label: '작업종료' };
  if (i.startedAt) return { key: 'STARTED', label: '작업개시' };
  if ((i.status ?? '') === 'REJECTED') return { key: 'REJECTED', label: '반려' };

  if (!isSig(i.issuerSignature)) return { key: 'WAITING', label: '대기' };

  // 2차(입회) 전: TBM 완료 여부로 "현장확인 필요"(TBM 대기) vs "2차 승인 대기"(TBM 됨) 구분.
  //  ⚠️ 2차 서명이 있으면 TBM 유무와 무관하게 다음 단계로 진행(안전환경이 경고 후 2차 직행 가능).
  if (!isSig(i.witnessSignature)) {
    const tbmHasContent = (i.photoCount ?? 0) > 0 || (i.workerConfirmCount ?? 0) > 0;
    return tbmHasContent
      ? { key: 'WITNESS_WAIT', label: '2차 승인 대기' }
      : { key: 'SITE_CHECK', label: '현장확인 필요' };
  }

  const supp = i.supplemental ?? {};
  const suppKeys = Object.keys(supp).filter((k) => supp[k] === 'Y');
  const dc = i.deptConfirmations ?? {};
  const allThird = suppKeys.every((k) => isSig(dc[k]?.signature));
  if (suppKeys.length > 0 && !allThird) return { key: 'THIRD_CHECK', label: '3차 확인 필요' };

  return { key: 'START_READY', label: '작업개시 가능' };
}

/** work_permits row(스네이크) → StageInput 정규화 후 stage 계산 */
export function stageFromRow(row: any): Stage {
  const tbm = (row?.tbm ?? {}) as Record<string, any>;
  const confs = tbm.confirmations ?? {};
  const workerConfirmCount = Object.values(confs).filter((c: any) => isSig(c?.signature)).length;
  const comp = (row?.completion ?? {}) as Record<string, any>;
  return computeStage({
    status: row?.status ?? null,
    issuerSignature: row?.issuer_signature ?? null,
    witnessSignature: tbm.witness?.signature ?? null,
    photoCount: Array.isArray(tbm.photos) ? tbm.photos.length : 0,
    workerConfirmCount,
    supplemental: row?.supplemental ?? {},
    deptConfirmations: row?.dept_confirmations ?? {},
    startedAt: row?.started_at ?? null,
    completionConfirmed: isSig(comp.confirmSignature),
  });
}

/**
 * 목록용 경량 판정 — 무거운 tbm/서명 blob 없이 가벼운 컬럼만으로 계산.
 * (목록은 500행까지라 base64 서명을 대량 조회하면 응답이 커져 쓰기 경합 유발 → 조회 최소화)
 * 정확: 대기/작업개시(started_at)/작업종료(status COMPLETED=R-6 전용)/반려. 중간단계는 '승인 진행중'으로 통합.
 * 상세화면은 단일행이라 computeStage 로 정밀 표시.
 */
export function stageFromLightRow(row: any): Stage {
  if ((row?.status ?? '') === 'COMPLETED') return { key: 'CLOSED', label: '작업종료' };
  if (row?.started_at) return { key: 'STARTED', label: '작업개시' };
  if ((row?.status ?? '') === 'REJECTED') return { key: 'REJECTED', label: '반려' };
  if (!isSig(row?.issuer_signature)) return { key: 'WAITING', label: '대기' };
  return { key: 'IN_PROGRESS', label: '승인 진행중' };
}

/** 뱃지 색상 클래스(Tailwind) — 화면 공통 */
export const STAGE_BADGE_CLASS: Record<StageKey, string> = {
  WAITING: 'bg-slate-100 text-slate-600',
  SITE_CHECK: 'bg-amber-100 text-amber-700',
  WITNESS_WAIT: 'bg-amber-100 text-amber-700',
  THIRD_CHECK: 'bg-orange-100 text-orange-700',
  START_READY: 'bg-sky-100 text-sky-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  STARTED: 'bg-emerald-100 text-emerald-700',
  CLOSED: 'bg-indigo-100 text-indigo-700',
  REJECTED: 'bg-red-100 text-red-700',
};
