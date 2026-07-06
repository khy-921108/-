-- ==========================================================
-- 1C-1: 작업허가서(일반위험작업) — work_permits + 참여자 + 신청번호 RPC
-- 002_companies.sql / 003_members_and_fields.sql 이 먼저 적용돼야 함.
-- 설계 기준:
--  · permit_type 항상 'GENERAL'(일반위험작업=마스터). 보충작업 7종은 supplemental JSONB 체크 기록만.
--  · 안전조치 16항목은 앱 미수집 → safety_checks 컬럼 없음(현장 빈칸).
--  · tbm JSONB = 헤더/참석자 스냅샷만. 위험요인·점검·날씨·서명은 양식 빈칸(현장).
--  · 스냅샷: 업체명/작업자명/차량/교육 유효기간 → 이후 값 변경에도 과거 출력물 불변.
--  · 신청번호 = next_work_permit_number() RPC 원자 발급(KST 일자별) + UNIQUE 백스톱.
-- ==========================================================

-- 1. 작업허가서 본문
CREATE TABLE IF NOT EXISTS work_permits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_number VARCHAR(20) UNIQUE NOT NULL,            -- YYYYMMDD-NNN (KST 기준)
  permit_type VARCHAR(30) NOT NULL DEFAULT 'GENERAL',   -- 항상 GENERAL(일반위험=마스터)
  request_company_id UUID REFERENCES companies(id),
  request_company_name VARCHAR(200) NOT NULL,           -- 스냅샷
  work_name VARCHAR(200) NOT NULL,
  work_location VARCHAR(200) NOT NULL,
  work_start TIMESTAMPTZ NOT NULL,
  work_end TIMESTAMPTZ NOT NULL,
  work_content TEXT NOT NULL,
  applicant_name VARCHAR(50) NOT NULL,
  applicant_phone VARCHAR(20) NOT NULL,
  applicant_title VARCHAR(50),                          -- 직책(선택)
  equipment_no VARCHAR(100),                            -- 장치번호/명(선택)
  -- 안전조치(safety_checks)는 1C-1 미수집(현장 빈칸) → 컬럼 없음
  tbm JSONB DEFAULT '{}'::jsonb,                         -- {datetime,place,workName,teamLeader:{company,name},attendees:[{name,company}]}
  supplemental JSONB DEFAULT '{}'::jsonb,                -- {confined,height,electric,excavation,hot,heavy,radiation:'Y'|'N', etcText?}
  note TEXT,
  status VARCHAR(20) DEFAULT 'SUBMITTED',               -- 2차 승인/반려 대비
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 참여자(신청 시점 스냅샷)
CREATE TABLE IF NOT EXISTS work_permit_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_permit_id UUID REFERENCES work_permits(id) ON DELETE CASCADE,
  session_id UUID REFERENCES training_sessions(id),
  name VARCHAR(50),
  phone VARCHAR(20),
  company_id UUID,
  company_name VARCHAR(200),                            -- 스냅샷
  target_type VARCHAR(20),
  vehicle_number VARCHAR(30),
  equipment_type VARCHAR(30),
  spec VARCHAR(100),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,                               -- 신청 시점 교육 유효기간 스냅샷
  sort_order INT
);

CREATE INDEX IF NOT EXISTS idx_wp_created ON work_permits(created_at);
CREATE INDEX IF NOT EXISTS idx_wp_company ON work_permits(request_company_id);
CREATE INDEX IF NOT EXISTS idx_wpp_permit ON work_permit_participants(work_permit_id);

-- 3. 신청번호 카운터 (KST 일자별)
CREATE TABLE IF NOT EXISTS work_permit_counters (
  day_kst DATE PRIMARY KEY,
  last_seq INT NOT NULL DEFAULT 0
);

-- 4. 원자적 신청번호 발급 함수 (ON CONFLICT … RETURNING)
CREATE OR REPLACE FUNCTION next_work_permit_number() RETURNS TEXT AS $$
DECLARE d DATE; s INT;
BEGIN
  d := (NOW() AT TIME ZONE 'Asia/Seoul')::date;
  INSERT INTO work_permit_counters(day_kst, last_seq) VALUES (d, 1)
    ON CONFLICT (day_kst) DO UPDATE SET last_seq = work_permit_counters.last_seq + 1
    RETURNING last_seq INTO s;
  RETURN to_char(d, 'YYYYMMDD') || '-' || lpad(s::text, 3, '0');
END; $$ LANGUAGE plpgsql;
