import type { CompanyType, CompanyStatus, CompanyCreatedBy } from './company';

export type TargetTypeCode = 'TRUCK' | 'WORKER' | 'HEAVY';

export type SessionStatus = 'IN_PROGRESS' | 'FAILED' | 'COMPLETED' | 'EXPIRED';

export type { CompanyType, CompanyStatus, CompanyCreatedBy };

export interface Company {
  id: string;
  name: string;
  biz_no: string | null;
  company_type: CompanyType;
  manager_name: string | null;
  phone: string | null;
  status: CompanyStatus;
  created_by: CompanyCreatedBy;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** 신청자 공개 검색 응답 — PII 제외 (담당자/연락처/사업자번호/비고 미포함) */
export interface CompanyPublicSummary {
  id: string;
  name: string;
  company_type: CompanyType;
  status: CompanyStatus;
}

export interface TargetType {
  id: number;
  code: TargetTypeCode;
  label: string;
}

export interface Course {
  id: number;
  target_type_id: number;
  title: string;
  version: number;
  is_active: boolean;
}

export interface CourseVideo {
  id: number;
  course_id: number;
  title: string;
  youtube_video_id: string;
  duration_sec: number;
  sort_order: number;
}

export interface Question {
  id: number;
  target_type_id: number;
  question_text: string;
  option_1: string;
  option_2: string;
  option_3: string;
  option_4: string;
  correct_option: number;
  explanation: string | null;
}

export interface QuestionClient {
  id: number;
  question_text: string;
  options: { no: 1 | 2 | 3 | 4; text: string }[];
}

export interface TrainingSession {
  id: string;
  affiliation: string;
  company_id: string | null;
  name: string;
  birth_date: string;
  phone: string;
  target_type_id: number;
  course_id: number;
  consent_yn: boolean;
  video_completed_yn: boolean;
  status: SessionStatus;
  created_at: string;
}

export interface Completion {
  id: string;
  session_id: string;
  target_type_id: number;
  course_id: number;
  course_version: number;
  exam_result_id: string;
  completion_number: string;
  completed_at: string;
  expires_at: string;
  score: number;
}
