-- ==========================================================
-- ③ 업체별 문서함 — 클라우드 저장소(Supabase Storage) 메타 테이블
-- 실제 파일은 Private 버킷 'company-documents' 에 저장.
--   경로: {companyId}/{category}/{yyyyMMdd-HHmmss}-{원본파일명}
-- 이 테이블은 "메타데이터"만 보관(파일 본문 아님).
-- 002_companies.sql 이 먼저 적용돼야 함(companies FK).
-- ==========================================================

CREATE TABLE IF NOT EXISTS company_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID REFERENCES companies(id) ON DELETE CASCADE,
  category     VARCHAR(30)  NOT NULL,            -- roster/permits/pledges/insurance/equipment/etc
  file_name    VARCHAR(300) NOT NULL,            -- 원본 파일명(표시용)
  storage_path VARCHAR(500) NOT NULL,            -- 버킷 내 경로(=업로드 위치)
  mime_type    VARCHAR(120),
  size_bytes   BIGINT,
  note         TEXT,
  uploaded_by  VARCHAR(120),                     -- 관리자 이메일 스냅샷
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_documents_company
  ON company_documents(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_documents_category
  ON company_documents(company_id, category);
