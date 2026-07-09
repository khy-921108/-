-- ==========================================================
-- R-6 게이트③-4: 관리자 서명 등록(설정 1회 → 승인 시 재사용) + 서명자 표기(이메일→이름·직책)
--  · 관리자마다 자기 서명 이미지 + 표시이름·직책·부서를 저장.
--  · 승인 서명(1차/2차 등) 시 등록 서명을 1클릭/자동으로 채움(하위호환: 없으면 손서명).
--  · 출력·화면에서 서명자 이메일 대신 "부서 이름 직책"(예: 안전환경 김형준 대리)로 표기.
--  · 전부 ADD COLUMN IF NOT EXISTS → 기존 데이터/로직 무영향.
-- ⚠️ 이 SQL 을 Supabase 에서 먼저 실행한 뒤 코드를 배포할 것.
-- ==========================================================

ALTER TABLE admins ADD COLUMN IF NOT EXISTS display_name VARCHAR(50);  -- 표시 이름 (예: 김형준)
ALTER TABLE admins ADD COLUMN IF NOT EXISTS title        VARCHAR(50);  -- 직책 (예: 대리)
ALTER TABLE admins ADD COLUMN IF NOT EXISTS department   VARCHAR(50);  -- 부서/소속 (예: 안전환경)
ALTER TABLE admins ADD COLUMN IF NOT EXISTS signature    TEXT;         -- 등록 서명 PNG data URL
