-- ==========================================================
-- R-6 게이트③-2b: 3차 별지 현장확인(별지코드별) + 종료 2단계 + 작업개시 최종승인
--  · 3차 확인 = 별지마다 "확인부서"(공무 또는 안전환경)가 개별 서명(일괄 금지).
--  · 화기·정전(전기) 별지 = 공무팀 담당 → 공무 확인(또는 SUPER 긴급대리) 없이는 작업개시 차단.
--  · 종료 = 신고(작업자/소장, 이번엔 안전환경 대리입력) → 확인(안전환경 최종) 2단계.
--  · 전부 ADD COLUMN IF NOT EXISTS → 기존 데이터/RLS/로직 무영향.
-- ⚠️ 이 SQL 을 Supabase 에서 먼저 실행한 뒤 코드를 배포할 것.
-- ==========================================================

-- 1) 별지별 3차 현장확인 기록 (별지코드 → 확인 스냅샷)
--    dept_confirmations = {
--      <supKey>: {
--        dept: '공무' | '안전환경',        -- 확인 담당부서(매트릭스 고정)
--        by:   text,                       -- 처리자(로그인 관리자 이메일) — 서버가 채움
--        name: text | null,                -- 표기용 성명(선택)
--        signature: dataURL,               -- 서명 PNG
--        at:   ISO,                        -- 처리 시각 — 서버가 채움
--        mode: 'NORMAL' | 'EMERGENCY_PROXY',  -- 정상확인 / 안전환경 긴급대리
--        reason: text | null               -- 긴급대리 사유(EMERGENCY_PROXY 필수)
--      }
--    }
ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS dept_confirmations JSONB DEFAULT '{}'::jsonb;

-- 2) 작업개시 최종승인(=status 'APPROVED' 전환) 기록
ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS started_by VARCHAR(120);
ALTER TABLE work_permits ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- 3) 종료 2단계는 기존 completion JSONB(012) 확장으로 처리 — 별도 DDL 불필요.
--    completion = {
--      completedAt, workerSignature, restoreState,   -- ① 종료신고(작업자/소장; 안전환경 대리입력)
--      reportBy, reportAt,                            -- 신고 기록자·시각
--      confirmSignature, confirmBy, confirmAt         -- ② 종료확인(안전환경 최종) → status 'COMPLETED'
--    }

-- 참고: status VARCHAR(20) 는 CHECK 제약이 없어 'SUBMITTED'/'APPROVED'/'REJECTED'/'COMPLETED' 자유 사용.
