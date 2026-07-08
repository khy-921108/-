-- ==========================================================
-- R-6: 작업허가 통합양식 개편 — 디지털 서명/승인/TBM 상세/완료 데이터 저장
--  · 승인 규칙(2026-07-07 확정): 승인자 = 요청·주관부서 현장 책임자(차장/대리),
--    발급자 = 안전환경담당(검토·발급). 안전환경 단독 승인 금지. 공장장 단계 없음.
--  · 기존 approved_by / approved_at 은 "이름·의미 변경 없이" 안전환경담당 발급·검토 기록으로 유지.
--    (issuer_name = approved_by, issued_at = approved_at)
--  · 요청부서 현장책임자 승인은 approver_* 계열로 분리 신설.
--  · 전부 ADD COLUMN IF NOT EXISTS → 기존 데이터/로직 무영향.
-- ⚠️ 이 SQL을 Supabase에서 먼저 실행한 뒤 코드를 배포할 것(컬럼 없으면 저장/조회 오류).
-- ==========================================================

-- 1) 신청인 디지털 서명 (PNG data URL). 참여자 서약 서명과 매칭되면 앱에서 프리필 가능.
ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS applicant_signature TEXT;

-- 2) 발급자(안전환경담당) — approved_by/approved_at 유지 + 직책·서명 보강
ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS issuer_title      VARCHAR(50);
ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS issuer_signature  TEXT;

-- 3) 승인자(요청·주관부서 현장 책임자) — 신규 계열
ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS approver_name       VARCHAR(50);
ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS approver_title      VARCHAR(50);
ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS approver_signature  TEXT;
ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS approval_mode       VARCHAR(10);  -- 'SITE'(현장) | 'REMOTE'(원격)
ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS approver_signed_at  TIMESTAMPTZ;

-- 4) 작업완료 확인(종료란) 스냅샷 JSONB
--    { completedAt: ISO, workerSignature: dataURL, restoreState: text, witnessName?: text }
ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS completion JSONB DEFAULT '{}'::jsonb;

-- 5) TBM JSONB 확장(스키마 변경 없음, 저장 형태만 확장) — 참고용 문서화:
--    tbm = {
--      datetime, place, workName,
--      teamLeader:   { company, name, signature? },      -- 팀장(=신청인)
--      safetyManager:{ name, signature? },               -- 안전관리자
--      workContent:  string,                             -- ▶ 작업 내용
--      riskFactors:  string[],                           -- ▶ 위험 요인 (행 8~13)
--      safetyMeasures: string[],                         -- ▶ 안전 대책 (행 8~13)
--      attendees:    [{ name, company, signature? }],    -- 참석자(서명은 참여자 서약 서명 재사용 가능)
--      photos:       [dataURL]                           -- 현장 사진(오버레이 삽입)
--    }
--    → 별도 DDL 불필요. 앱/출력 코드에서 위 형태로 읽고 쓴다.

-- (선택) 승인 방식 값 방어 — 잘못된 문자열 저장 방지. 이미 있으면 무시.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'work_permits' AND constraint_name = 'work_permits_approval_mode_chk'
  ) THEN
    ALTER TABLE work_permits
      ADD CONSTRAINT work_permits_approval_mode_chk
      CHECK (approval_mode IS NULL OR approval_mode IN ('SITE','REMOTE'));
  END IF;
END $$;
