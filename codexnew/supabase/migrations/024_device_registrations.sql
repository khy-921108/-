-- ==========================================================
-- 024: "이 휴대폰 기억하기" 기기 등록
--  · 신규 표 1개만 추가한다. 기존 표는 바꾸지 않는다.
--  · 열쇠 원문은 저장하지 않는다. 휴대폰 쿠키에 든 열쇠의 SHA-256 해시만 둔다.
--  · 기억 기간 90일(expires_at). 해제하면 revoked_at·revoked_reason 을 남긴다.
--  · 서버(service_role)만 읽고 쓴다. 화면(anon·authenticated)은 접근할 수 없다.
--  · 여러 번 실행해도 안전하다.
-- ==========================================================

CREATE TABLE IF NOT EXISTS device_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(50) NOT NULL,
  birth_date DATE NOT NULL,
  phone VARCHAR(20) NOT NULL,
  user_agent VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason VARCHAR(20)
);

CREATE INDEX IF NOT EXISTS idx_device_registrations_phone ON device_registrations(phone);
CREATE INDEX IF NOT EXISTS idx_device_registrations_person ON device_registrations(name, birth_date, phone);

ALTER TABLE device_registrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON device_registrations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON device_registrations TO service_role;
