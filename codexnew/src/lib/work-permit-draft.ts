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
