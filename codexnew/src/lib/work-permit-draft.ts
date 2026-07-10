'use client';

/**
 * 작업허가 신청 4단계 공유 상태 — sessionStorage['wpDraft'].
 * 서버 import 없음(클라 전용). 각 단계 진입 시 read, '다음'에서 머지·save, 제출 성공 시 clear.
 */

export interface WpParticipant {
  name: string;
  birthDate: string;
  phone: string;
  // 표시용 스냅샷(검증 결과)
  companyName?: string | null;
  targetLabel?: string | null;
  vehicleNumber?: string | null;
  spec?: string | null;
  completedAt?: string | null;
  expiresAt?: string | null;
  marginDays?: number | null;
}

export interface WpDraft {
  applicant?: {
    name: string;
    birthDate: string;
    phone: string;
    companyId: string | null;
  };
  company?: { id: string; name: string } | null;
  info?: {
    workName: string;
    workLocation: string;
    workStart: string;
    workEnd: string;
    workContent: string;
    applicantName: string;
    applicantTitle?: string;
    equipmentNo?: string;
  };
  supplemental?: Record<string, 'Y' | 'N'>;
  participants?: WpParticipant[];
  // ===== R-6: 승인 규칙 / 디지털 서명 / TBM 상세 =====
  /** 승인자 = 요청·주관부서 현장 책임자(차장/대리). 서명은 후속 승인 단계에서 저장 가능. */
  approval?: {
    approverName?: string;
    approverTitle?: string;
    approvalMode?: 'SITE' | 'REMOTE';
  };
  /** TBM 디지털 기록 상세(양식 ▶작업내용/위험요인/안전대책 + 안전관리자) */
  tbmDetail?: {
    workContent?: string;
    riskFactors?: string[];
    safetyMeasures?: string[];
    safetyManagerName?: string;
    /** 안전관리자 소속: 사내(동남) | 작업업체 */
    safetyManagerAffiliation?: 'INTERNAL' | 'CONTRACTOR';
  };
  /** 디지털 서명(PNG data URL). 신청인 서명은 TBM 팀장 서명으로도 사용. */
  signatures?: {
    applicant?: string;
    safetyManager?: string;
  };
  /** TBM 현장 사진(PNG/JPEG data URL, 최대 4장) */
  photos?: string[];
  /** 복사 재신청으로 만든 초안 — 제출 화면에서 "오늘 조건 확인" 필수 체크 요구 */
  copied?: boolean;
}

const KEY = 'wpDraft';

export function readDraft(): WpDraft {
  if (typeof window === 'undefined') return {};
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as WpDraft) : {};
  } catch {
    return {};
  }
}

export function writeDraft(patch: Partial<WpDraft>): WpDraft {
  const cur = readDraft();
  const next = { ...cur, ...patch };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
