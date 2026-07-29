-- ==========================================================
-- 현장 합류자 + 장비 도착 등록 (append-only, 시각 기록)
--  · field_joins        = [{ name, phone(정규화), companyName, joinedAt, ... }] 현장 합류 기록.
--    (합류자는 work_permit_participants 에도 추가되어 전원 서명 판정·출력에 자동 포함.
--     field_joins 는 "언제 합류했는지" 메타 기록 — 삭제되지 않음)
--  · equipment_arrivals = [{ type, vehicleNumber, photo(스토리지 키), at }] 장비 도착 기록.
--  · ADD COLUMN IF NOT EXISTS → 기존 데이터/RLS/로직 무영향.
-- ⚠️ 이 SQL 을 Supabase 에서 먼저 실행한 뒤 코드를 배포할 것. (기존 규칙)
-- ==========================================================

ALTER TABLE work_permits
  ADD COLUMN IF NOT EXISTS field_joins JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE work_permits
  ADD COLUMN IF NOT EXISTS equipment_arrivals JSONB NOT NULL DEFAULT '[]'::jsonb;
