-- ==========================================================
-- 1B: 화물차/중장비 확장 필드 + company_members(업체 소속 인원)
-- 002_companies.sql 이 이미 적용되어 있어야 합니다.
-- Supabase PG15+ 의 NULLS NOT DISTINCT 기능 사용 (Free 플랜 포함 기본 지원).
-- ==========================================================

-- 1. training_sessions 확장 필드
ALTER TABLE training_sessions
  ADD COLUMN IF NOT EXISTS spec VARCHAR(100);                -- 톤수/규격 (자유 입력)
ALTER TABLE training_sessions
  ADD COLUMN IF NOT EXISTS equipment_type VARCHAR(30);       -- EXCAVATOR/FORKLIFT/LADDER/CRANE/ETC
ALTER TABLE training_sessions
  ADD COLUMN IF NOT EXISTS equipment_type_etc VARCHAR(100);  -- equipment_type='ETC' 일 때 직접입력값

-- equipment_type 값 무결성 (NULL 허용)
ALTER TABLE training_sessions DROP CONSTRAINT IF EXISTS chk_training_sessions_equipment_type;
ALTER TABLE training_sessions
  ADD CONSTRAINT chk_training_sessions_equipment_type
  CHECK (equipment_type IS NULL OR equipment_type IN ('EXCAVATOR','FORKLIFT','LADDER','CRANE','ETC'));

-- 2. company_members — 업체별 인원 마스터
CREATE TABLE IF NOT EXISTS company_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  member_type VARCHAR(20) NOT NULL DEFAULT 'WORKER'
    CHECK (member_type IN ('WORKER','TRUCK','HEAVY')),
  name VARCHAR(50) NOT NULL,
  birth_date DATE,
  phone VARCHAR(20),
  normalized_phone VARCHAR(20),                              -- 숫자만 추출본 (매칭 안정화)
  vehicle_number VARCHAR(30),
  equipment_type VARCHAR(30)
    CHECK (equipment_type IS NULL OR equipment_type IN ('EXCAVATOR','FORKLIFT','LADDER','CRANE','ETC')),
  equipment_type_etc VARCHAR(100),
  spec VARCHAR(100),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 중복 방지 UNIQUE: (company_id, name, birth_date, normalized_phone)
--    NULLS NOT DISTINCT → NULL 도 같은 값으로 간주해 우회 방지
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_members
  ON company_members (company_id, name, birth_date, normalized_phone)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_company_members_company_id ON company_members(company_id);
CREATE INDEX IF NOT EXISTS idx_company_members_name_birth_phone
  ON company_members(name, birth_date, normalized_phone);

-- 4. updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION set_company_members_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_company_members_updated_at ON company_members;
CREATE TRIGGER trg_company_members_updated_at
  BEFORE UPDATE ON company_members
  FOR EACH ROW
  EXECUTE FUNCTION set_company_members_updated_at();
