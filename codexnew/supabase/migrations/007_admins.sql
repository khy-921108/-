-- ==========================================================
-- 1D-1: 어드민 다중계정 + 할당형 권한
-- requireAdmin 이 "로그인=통과" → "admins 허용목록(active) 통과" 로 강화됨.
-- 🔴 절대 안전: 최초 SUPER 시드를 반드시 포함(누락 시 전 관리자 잠김).
--    이 마이그레이션을 **코드 배포보다 먼저** 적용해야 함.
-- ==========================================================

CREATE TABLE IF NOT EXISTS admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  UUID,                                   -- Supabase Auth user.id (시드는 NULL, 이메일로 매칭)
  email         VARCHAR(200) UNIQUE NOT NULL,           -- 소문자 저장(코드에서 lower)
  role          VARCHAR(10) NOT NULL DEFAULT 'ADMIN'
                  CHECK (role IN ('SUPER','ADMIN')),
  permissions   JSONB NOT NULL DEFAULT '[]'::jsonb,     -- 권한키 배열(SUPER는 무시·전체통과)
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_by    VARCHAR(200),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admins_email_lower ON admins (lower(email));

-- 🔴 최초 SUPER 시드 — 이게 없으면 모든 관리자가 잠긴다. 반드시 유지.
INSERT INTO admins (email, role, permissions, is_active, created_by)
VALUES ('tkxnflgudwns@naver.com', 'SUPER', '[]'::jsonb, true, 'seed')
ON CONFLICT (email) DO NOTHING;
