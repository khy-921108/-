import type { CompanyType, CompanyStatus, CompanyCreatedBy } from './company';
import type { EquipmentType, MemberType } from './equipment';

export type TargetTypeCode = 'TRUCK' | 'WORKER' | 'HEAVY';

export type SessionStatus = 'IN_PROGRESS' | 'FAILED' | 'COMPLETED' | 'EXPIRED';

export type { CompanyType, CompanyStatus, CompanyCreatedBy };
export type { EquipmentType, MemberType };

export interface CompanyMember {
  id: string;
  company_id: string | null;
  member_type: MemberType;
  name: string;
  birth_date: string | null;
  phone: string | null;
  normalized_phone: string | null;
  vehicle_number: string | null;
  equipment_type: EquipmentType | null;
  equipment_type_etc: string | null;
  spec: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

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
  vehicle_number: string | null;
  spec: string | null;
  equipment_type: EquipmentType | null;
  equipment_type_etc: string | null;
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

// ===== 1C-1 작업허가서 =====
export type SupplementalFlag = 'Y' | 'N';

export interface WorkPermit {
  id: string;
  permit_number: string;
  permit_type: 'GENERAL';
  request_company_id: string | null;
  request_company_name: string;
  work_name: string;
  work_location: string;
  work_start: string;
  work_end: string;
  work_content: string;
  applicant_name: string;
  applicant_phone: string;
  applicant_title: string | null;
  equipment_no: string | null;
  tbm: WorkPermitTbm;
  supplemental: Record<string, SupplementalFlag>;
  note: string | null;
  status: string;
  created_at: string;
}

export interface WorkPermitTbm {
  datetime?: string;
  place?: string;
  workName?: string;
  teamLeader?: { company: string | null; name: string };
  attendees?: { name: string | null; company: string | null }[];
}

export interface WorkPermitParticipant {
  id: string;
  work_permit_id: string;
  session_id: string | null;
  name: string | null;
  phone: string | null;
  company_id: string | null;
  company_name: string | null;
  target_type: string | null;
  vehicle_number: string | null;
  equipment_type: string | null;
  spec: string | null;
  completed_at: string | null;
  expires_at: string | null;
  sort_order: number | null;
}
