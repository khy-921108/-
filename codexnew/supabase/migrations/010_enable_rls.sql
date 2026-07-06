-- ==========================================================
-- R-4: public 스키마 전 테이블 RLS 활성화 (anon/authenticated 전면 차단)
-- ----------------------------------------------------------
-- 목적: anon 공개키로 Supabase REST 직접 조회를 막는다.
--   - 모든 API 라우트는 service_role 사용(RLS 우회) → 앱 기능 무영향.
--   - 정책(CREATE POLICY) 0개 = 기본 거부. GRANT 변경 없음.
--   - Storage(storage 스키마)는 건드리지 않음 → company-documents 버킷 무영향.
-- 안전: ENABLE ROW LEVEL SECURITY 는 멱등(이미 켜진 테이블 재실행해도 무해).
--       문제 시 개별 롤백: ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;
-- ==========================================================

-- public 스키마의 모든 base 테이블을 순회하며 RLS ON (빠지는 테이블 0개 보장)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
    RAISE NOTICE 'RLS enabled: %', r.tablename;
  END LOOP;
END $$;

-- ---------- 확인용 (실행 후 별도로 돌려보세요) ----------
-- ① RLS 켜진 테이블 수 == 전체 테이블 수 여야 함
-- SELECT count(*) FILTER (WHERE rowsecurity) AS rls_on,
--        count(*)                            AS total
-- FROM pg_tables WHERE schemaname = 'public';
--
-- ② 테이블별 상태 (rowsecurity 전부 true 여야 함)
-- SELECT tablename, rowsecurity
-- FROM pg_tables WHERE schemaname = 'public'
-- ORDER BY tablename;
