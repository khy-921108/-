-- ==========================================================
-- 업체 체계 개편: 주소·대표번호·국세청 확인 결과 + app_settings RLS
--  · companies 컬럼 추가만(기존 데이터 무손상, 담당자명·연락처 값 유지).
--  · app_settings RLS 활성화(정책 없음) — service_role 만 접근.
--    (국세청 API 키 BIZNO_API_KEY 를 저장하므로 anon 직접 읽기 차단.
--     기존 API 는 전부 service_role 경유라 무영향.)
-- ⚠️ 이 SQL 을 Supabase 에서 먼저 실행한 뒤 코드를 배포할 것. (기존 규칙)
-- ==========================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS address VARCHAR(300);        -- 사업장 주소
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tel VARCHAR(20);             -- 대표번호
ALTER TABLE companies ADD COLUMN IF NOT EXISTS biz_status VARCHAR(30);      -- 국세청 확인 결과(계속사업자/휴업자/폐업자/확인불가 등)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS biz_checked_at TIMESTAMPTZ;  -- 국세청 확인 시각

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
