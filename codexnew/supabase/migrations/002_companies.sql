-- ==========================================================
-- 1A: 업체(companies) 도입 + training_sessions.company_id 연결
-- Supabase SQL Editor에 이 파일 전체를 복사해 실행하세요.
-- 001_schema.sql 이 이미 적용되어 있어야 합니다.
-- ==========================================================

-- 1. 업체 마스터
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  biz_no VARCHAR(20),
  company_type VARCHAR(20) NOT NULL DEFAULT 'GENERAL'
    CHECK (company_type IN ('GENERAL','INDIVIDUAL','TRANSPORT','EQUIPMENT','TEMP')),
  manager_name VARCHAR(50),
  phone VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'REVIEW'
    CHECK (status IN ('REVIEW','ACTIVE','DISABLED')),
  created_by VARCHAR(20) NOT NULL DEFAULT 'APPLICANT'
    CHECK (created_by IN ('APPLICANT','ADMIN')),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 검색용 인덱스 (업체명 부분일치 검색 가속)
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);
CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);

-- 3. updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION set_companies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW
  EXECUTE FUNCTION set_companies_updated_at();

-- 4. training_sessions 에 company_id 연결 (기존 affiliation 컬럼은 그대로 유지)
ALTER TABLE training_sessions
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);

CREATE INDEX IF NOT EXISTS idx_training_sessions_company_id
  ON training_sessions(company_id);
