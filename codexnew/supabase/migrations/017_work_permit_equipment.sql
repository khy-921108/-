-- ==========================================================
-- R-6: 중장비·굴착 작업 장비 정보(종류·차량번호·교육차량 대조결과) 저장
--  · equipment = [{ type, vehicleNumber, matched }, ...]  (append 아님, 신청 시 확정 스냅샷)
--  · matched = 입력 차량번호가 HEAVY 교육 수료 참여자의 등록 차량번호와 일치하는지.
--  · ADD COLUMN IF NOT EXISTS → 기존 데이터/RLS/로직 무영향.
-- ⚠️ 이 SQL 을 Supabase 에서 먼저 실행한 뒤 코드를 배포할 것. (015 잠김 사고 규칙)
-- ==========================================================

ALTER TABLE work_permits
  ADD COLUMN IF NOT EXISTS equipment JSONB NOT NULL DEFAULT '[]'::jsonb;
