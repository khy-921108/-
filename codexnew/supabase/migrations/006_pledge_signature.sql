-- ==========================================================
-- 1C-2 확장(A): 개인 안전준수 서약에 작업자 본인 디지털 서명 저장.
-- signature = PNG data URL(base64) 문자열. 미서명 시 NULL.
-- ==========================================================
ALTER TABLE safety_pledges
  ADD COLUMN IF NOT EXISTS signature TEXT;
