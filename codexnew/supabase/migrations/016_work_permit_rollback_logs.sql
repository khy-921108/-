-- ==========================================================
-- R-6: 작업허가 승인 단계 "이전 단계로 되돌리기" 이력 저장
--  · 되돌리기 = 서류를 버리지 않고 마지막 완료 단계 1칸만 취소(반려와 완전히 다른 기능).
--  · 취소 이력을 영구 보존(누가·언제·어느 단계·사유). 절대 삭제되지 않는다.
--  · rollback_logs = [{ stage, label, supKey, by, at, reason }, ...] (append-only).
--  · ADD COLUMN IF NOT EXISTS → 기존 데이터/RLS/로직 무영향.
-- ⚠️ 이 SQL 을 Supabase 에서 먼저 실행한 뒤 코드를 배포할 것. (migration 015 잠김 사고 교훈)
-- ==========================================================

ALTER TABLE work_permits
  ADD COLUMN IF NOT EXISTS rollback_logs JSONB NOT NULL DEFAULT '[]'::jsonb;
