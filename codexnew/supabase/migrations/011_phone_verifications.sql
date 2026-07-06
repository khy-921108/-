-- ==========================================================
-- R-5: 휴대폰 문자 인증(OTP) — phone_verifications + OTP 설정값
-- ⚠️ 이 SQL을 코드 배포보다 먼저 실행할 것.
-- ==========================================================

CREATE TABLE IF NOT EXISTS phone_verifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       VARCHAR(20) NOT NULL,          -- 숫자만 정규화 저장
  code_hash   VARCHAR(64) NOT NULL,          -- sha256(salt + code) hex — 평문 저장 금지
  salt        VARCHAR(32) NOT NULL,          -- 행별 무작위 salt
  expires_at  TIMESTAMPTZ NOT NULL,          -- 발송시각 + OTP_TTL_SEC
  attempts    INT NOT NULL DEFAULT 0,        -- 확인 시도 횟수(5회 초과 무효)
  verified_at TIMESTAMPTZ,                   -- 인증 성공 시각(NULL=미인증)
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_verifications_phone
  ON phone_verifications(phone, created_at DESC);

-- RLS ON, 정책 0개 (서버 service_role 만 접근 — R-4 와 동일 원칙)
ALTER TABLE phone_verifications ENABLE ROW LEVEL SECURITY;

-- OTP 설정값 (코드는 하드코딩 없이 이 값을 읽음)
INSERT INTO app_settings (key, value, description) VALUES
  ('OTP_TTL_SEC',    '120', '인증번호 유효시간(초)'),
  ('OTP_RESEND_SEC', '90',  '인증번호 재전송 대기시간(초)')
ON CONFLICT (key) DO NOTHING;

-- 확인용:
-- SELECT key, value FROM app_settings WHERE key LIKE 'OTP%';
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename='phone_verifications';
