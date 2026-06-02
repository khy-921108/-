-- ==========================================================
-- 004b_applicant_birth.sql
-- 본인조회 3필드 보안: work_permits 에 신청자 생년월일 스냅샷 추가.
-- ==========================================================
ALTER TABLE work_permits
  ADD COLUMN IF NOT EXISTS applicant_birth_date DATE;
