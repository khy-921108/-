-- ==========================================================
-- 004c_link_legacy_company.sql
-- 기존 수료자(1A 이전) training_sessions.company_id(NULL) 백필.
-- affiliation을 TRIM해 companies.name(TRIM)과 "정확히 1개" 매칭될 때만 연결.
-- 미매칭/동명다수는 NULL 유지. 업체 자동생성 금지.
-- 실행 순서: (1)(2)(3) SELECT 확인 → 문제 없으면 (4) UPDATE 1회.
-- ==========================================================

-- (1) 연결 대상 미리보기 — company_id 가 채워질 세션
SELECT t.id AS session_id, t.name AS worker_name,
       TRIM(t.affiliation) AS affiliation,
       c.id AS will_link_company_id, c.name AS company_name, c.status AS company_status
FROM training_sessions t
JOIN companies c ON TRIM(c.name) = TRIM(t.affiliation)
WHERE t.company_id IS NULL
  AND COALESCE(TRIM(t.affiliation), '') <> ''
  AND (SELECT COUNT(*) FROM companies c2 WHERE TRIM(c2.name) = TRIM(t.affiliation)) = 1
ORDER BY affiliation, worker_name;

-- (2) 미매칭 — 해당 업체 0개 (업체 등록 후 재실행 필요)
SELECT TRIM(t.affiliation) AS affiliation, COUNT(*) AS session_count
FROM training_sessions t
WHERE t.company_id IS NULL
  AND COALESCE(TRIM(t.affiliation), '') <> ''
  AND (SELECT COUNT(*) FROM companies c2 WHERE TRIM(c2.name) = TRIM(t.affiliation)) = 0
GROUP BY TRIM(t.affiliation)
ORDER BY session_count DESC;

-- (3) 동명다수 — 같은 이름 업체 2개+ (자동연결 제외)
SELECT TRIM(t.affiliation) AS affiliation,
       (SELECT COUNT(*) FROM companies c2 WHERE TRIM(c2.name) = TRIM(t.affiliation)) AS company_count,
       COUNT(*) AS session_count
FROM training_sessions t
WHERE t.company_id IS NULL
  AND COALESCE(TRIM(t.affiliation), '') <> ''
  AND (SELECT COUNT(*) FROM companies c2 WHERE TRIM(c2.name) = TRIM(t.affiliation)) > 1
GROUP BY TRIM(t.affiliation)
ORDER BY session_count DESC;

-- (4) 실제 연결 — (1) 확인 후에만 실행. 정확히 1개 매칭만.
UPDATE training_sessions t
SET company_id = c.id
FROM companies c
WHERE t.company_id IS NULL
  AND COALESCE(TRIM(t.affiliation), '') <> ''
  AND TRIM(c.name) = TRIM(t.affiliation)
  AND (SELECT COUNT(*) FROM companies c2 WHERE TRIM(c2.name) = TRIM(t.affiliation)) = 1;
