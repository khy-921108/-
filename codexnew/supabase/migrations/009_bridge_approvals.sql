-- ==========================================================
-- R-2: 브리지 쓰기(승인) — 처리자/처리시각 기록 컬럼
-- SHE 포털에서 업체·작업허가를 승인/반려할 때 "누가·언제" 처리했는지 기록.
-- 전부 ADD COLUMN IF NOT EXISTS → 기존 데이터/로직 무영향.
-- ⚠️ 이 SQL을 먼저 실행한 뒤 코드를 배포할 것(컬럼 없으면 조회/기록 오류).
-- ==========================================================

-- 업체: 상태 변경 처리자/시각 (REVIEW→ACTIVE 승인 / REVIEW→DISABLED 반려)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS status_changed_by  VARCHAR(200);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS status_changed_at  TIMESTAMPTZ;

-- 작업허가: 승인 처리자/시각 (기존 status 컬럼 재사용: SUBMITTED→APPROVED/REJECTED)
ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS approved_by  VARCHAR(200);
ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ;
