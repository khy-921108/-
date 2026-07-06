-- ==========================================================
-- 1C-2: 6개월 필수문서 — 개인서약(#8) + 업체이행각서(#9)
-- (#7 교육결과서는 별도 테이블 없음 — completions 재사용)
-- 004_work_permits.sql 이 먼저 적용돼야 함.
-- 유효성: expires_at = issued + 6개월. 검증은 expires_at >= work_end(작업종료일 기준).
-- ==========================================================

-- 1. 개인 안전준수 서약 (#8) — 사람 단위, 6개월 재사용
CREATE TABLE IF NOT EXISTS safety_pledges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL,
  birth_date DATE,
  phone VARCHAR(20),
  normalized_phone VARCHAR(20),               -- 숫자만(매칭 안정화)
  company_id UUID REFERENCES companies(id),
  company_name VARCHAR(200),                   -- 스냅샷
  nationality VARCHAR(30),                     -- 앱 입력
  blood_type VARCHAR(5),                       -- 앱 입력
  job_type VARCHAR(50),                        -- 앱 입력
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL              -- issued + 6개월
);

-- 2. 업체 안전작업 이행각서 (#9) — 업체 단위, 6개월 블랭킷
CREATE TABLE IF NOT EXISTS company_undertakings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id),
  company_name VARCHAR(200),                   -- 스냅샷
  work_area VARCHAR(200),                      -- 작업구역(대표/일반)
  manager_name VARCHAR(50),                    -- 관리감독자
  manager_phone VARCHAR(20),
  members JSONB DEFAULT '[]'::jsonb,           -- 커버 명단 [{name,birthDate,phone}] — 신규 인원 추가 시 재발급(새 행)
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pledges_person ON safety_pledges(normalized_phone, birth_date, name);
CREATE INDEX IF NOT EXISTS idx_pledges_expires ON safety_pledges(expires_at);
CREATE INDEX IF NOT EXISTS idx_undertakings_company ON company_undertakings(company_id, expires_at);
