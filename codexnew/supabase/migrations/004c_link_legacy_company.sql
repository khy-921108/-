-- ==========================================================
-- 004c_link_legacy_company.sql
-- 기존 수료자(1A 이전) training_sessions.company_id(NULL) 백필.
--
-- 규칙:
--  · affiliation을 TRIM하여 companies.name(TRIM)과 "정확히 1개" 매칭될 때만 연결.
--  · 미매칭(0개)·동명다수(2개 이상)는 그대로 NULL 유지.
--  · affiliation 으로 업체 자동생성 절대 금지(쓰레기 업체 방지).
--
-- 실행 순서: (1)(2)(3) SELECT 로 먼저 확인 → 문제 없으면 (4) UPDATE 1회 실행.
--   ※ (4) 실행 후 미매칭(2)에 해당하는 업체는 관리자가 정식 등록한 뒤 (4)를 재실행하면 추가 연결됨.
-- 참고: 런타임 게이트가 status='DISABLED' 업체는 NO_COMPANY 처리하므로,
--       사용중지 업체로 연결돼도 진입은 막힘(데이터 연결만 됨).
-- ==========================================================


-- ----------------------------------------------------------
-- (1) 연결 대상 미리보기 — 이 세션들의 company_id 가 채워질 예정
--     (company_id NULL + affiliation 이 정확히 1개 업체와 매칭)
-- ----------------------------------------------------------
SELECT t.id            AS session_id,
       t.name          AS worker_name,
       TRIM(t.affiliation) AS affiliation,
       c.id            AS will_link_company_id,
       c.name          AS company_name,
       c.status        AS company_status
FROM training_sessions t
JOIN companies c ON TRIM(c.name) = TRIM(t.affiliation)
WHERE t.company_id IS NULL
  AND COALESCE(TRIM(t.affiliation), '') <> ''
  AND (SELECT COUNT(*) FROM companies c2 WHERE TRIM(c2.name) = TRIM(t.affiliation)) = 1
ORDER BY affiliation, worker_name;


-- ----------------------------------------------------------
-- (2) 미매칭 — affiliation 에 해당하는 업체가 0개 (자동연결 불가)
--     → 관리자가 해당 업체를 정식 등록한 뒤 (4) 재실행하면 연결됨
-- ----------------------------------------------------------
SELECT TRIM(t.affiliation) AS affiliation,
       COUNT(*)            AS session_count
FROM training_sessions t
WHERE t.company_id IS NULL
  AND COALESCE(TRIM(t.affiliation), '') <> ''
  AND (SELECT COUNT(*) FROM companies c2 WHERE TRIM(c2.name) = TRIM(t.affiliation)) = 0
GROUP BY TRIM(t.affiliation)
ORDER BY session_count DESC;


-- ----------------------------------------------------------
-- (3) 동명다수 — 같은 이름 업체가 2개 이상 (모호 → 자동연결 제외, 수동 판단)
-- ----------------------------------------------------------
SELECT TRIM(t.affiliation) AS affiliation,
       (SELECT COUNT(*) FROM companies c2 WHERE TRIM(c2.name) = TRIM(t.affiliation)) AS company_count,
       COUNT(*)            AS session_count
FROM training_sessions t
WHERE t.company_id IS NULL
  AND COALESCE(TRIM(t.affiliation), '') <> ''
  AND (SELECT COUNT(*) FROM companies c2 WHERE TRIM(c2.name) = TRIM(t.affiliation)) > 1
GROUP BY TRIM(t.affiliation)
ORDER BY session_count DESC;


-- ----------------------------------------------------------
-- (4) 실제 연결 — 위 (1) 확인 후에만 실행.
--     정확히 1개 매칭되는 건만 company_id 채움. (미매칭/동명다수는 건드리지 않음)
-- ----------------------------------------------------------
UPDATE training_sessions t
SET company_id = c.id
FROM companies c
WHERE t.company_id IS NULL
  AND COALESCE(TRIM(t.affiliation), '') <> ''
  AND TRIM(c.name) = TRIM(t.affiliation)
  AND (SELECT COUNT(*) FROM companies c2 WHERE TRIM(c2.name) = TRIM(t.affiliation)) = 1;
-- 실행 후 반영 건수 확인: 위 UPDATE 가 'UPDATE N' 으로 N건 표시.
