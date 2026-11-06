-- ==========================================================
-- 023: 작업허가 "우리 업체 수료자 불러오기" 조회 기록
--  · 신규 표 1개만 추가한다. 기존 행의 값은 이 파일을 실행해도 바뀌지 않는다.
--  · 신청인이 소속 업체 수료자 목록을 볼 때마다 한 줄씩 남긴다(누가, 어느 업체를, 몇 명).
--  · company_id 는 외래키를 걸지 않는다. 기록이 있어도 관리자 업체 삭제가 막히면 안 되고,
--    업체가 지워져도 기록은 남아야 한다.
--  · 여러 번 실행해도 안전하다.
-- ==========================================================

CREATE TABLE IF NOT EXISTS company_roster_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_name VARCHAR(50) NOT NULL,
  applicant_phone VARCHAR(20) NOT NULL,
  company_id UUID NOT NULL,
  result_count INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_roster_access_logs_created ON company_roster_access_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_company_roster_access_logs_company ON company_roster_access_logs(company_id, created_at);

ALTER TABLE company_roster_access_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON company_roster_access_logs FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON company_roster_access_logs FROM service_role;
GRANT SELECT, INSERT ON company_roster_access_logs TO service_role;
