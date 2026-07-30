-- ==========================================================
-- 현장 추가 등록 통합 기록(작업자 합류 + 장비 도착 + 현장 사진 1장)
--  · field_additions = [{
--      at, actorType('APPLICANT'|'ADMIN'), actor,   -- 등록 시각·주체
--      photo,                                       -- 스토리지 키(항상 필수)
--      workers: [{ name, phone }],                  -- 이번 등록으로 합류한 작업자
--      equipment: [{ type, vehicleNumber }]         -- 이번 등록으로 도착한 장비
--    }]
--  · 사진 별지 시트「TBM 현장사진(추가)」·print 표시의 원본 기록.
--    (기존 field_joins·equipment_arrivals 는 합류 시각·장비 목록 용도로 계속 유지)
--  · ADD COLUMN IF NOT EXISTS → 기존 데이터/RLS/로직 무영향.
-- ⚠️ 이 SQL 을 Supabase 에서 먼저 실행한 뒤 코드를 배포할 것. (기존 규칙)
-- ==========================================================

ALTER TABLE work_permits
  ADD COLUMN IF NOT EXISTS field_additions JSONB NOT NULL DEFAULT '[]'::jsonb;
