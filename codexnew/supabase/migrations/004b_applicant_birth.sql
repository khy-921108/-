-- ==========================================================
-- 004b_applicant_birth.sql
-- 본인조회 3필드 보안: work_permits 에 신청자 생년월일 스냅샷 추가.
-- - POST /api/work-permits 제출 시 진입게이트에서 받은 신청자 생년월일을 저장.
-- - my-list 조회를 name+birth_date+phone 3필드로 강화(앱 표준 일치).
-- - 기존 행(NULL)은 3필드 조회 불가(테스트 레코드뿐 — 무시 가능).
-- ==========================================================
ALTER TABLE work_permits
  ADD COLUMN IF NOT EXISTS applicant_birth_date DATE;
