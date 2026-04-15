-- ==========================================================
-- 안전보건교육 수료 관리 시스템 — 초기 스키마 (v2)
-- Supabase SQL Editor에 이 파일 전체를 복사해 실행하세요.
-- ==========================================================

-- 1. 교육 대상 구분
CREATE TABLE IF NOT EXISTS target_types (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  label VARCHAR(50) NOT NULL
);

-- 2. 교육 과정
CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  target_type_id INT REFERENCES target_types(id),
  title VARCHAR(200) NOT NULL,
  version INT DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 과정별 영상 (과정당 N개)
CREATE TABLE IF NOT EXISTS course_videos (
  id SERIAL PRIMARY KEY,
  course_id INT REFERENCES courses(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  youtube_video_id VARCHAR(20) NOT NULL,
  duration_sec INT NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 시험 문항
CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  target_type_id INT REFERENCES target_types(id),
  question_text TEXT NOT NULL,
  option_1 VARCHAR(500) NOT NULL,
  option_2 VARCHAR(500) NOT NULL,
  option_3 VARCHAR(500) NOT NULL,
  option_4 VARCHAR(500) NOT NULL,
  correct_option SMALLINT NOT NULL CHECK (correct_option IN (1,2,3,4)),
  explanation TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. 교육 세션
CREATE TABLE IF NOT EXISTS training_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliation VARCHAR(100) NOT NULL,
  name VARCHAR(50) NOT NULL,
  birth_date DATE NOT NULL,
  phone VARCHAR(20) NOT NULL,
  target_type_id INT REFERENCES target_types(id),
  course_id INT REFERENCES courses(id),
  consent_yn BOOLEAN DEFAULT FALSE,
  video_completed_yn BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'IN_PROGRESS',  -- IN_PROGRESS / FAILED / COMPLETED / EXPIRED
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. 영상별 시청 로그
CREATE TABLE IF NOT EXISTS watch_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES training_sessions(id) ON DELETE CASCADE,
  course_video_id INT REFERENCES course_videos(id),
  watched_sec INT DEFAULT 0,
  progress_rate INT DEFAULT 0,
  completed_yn BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(session_id, course_video_id)
);

-- 7. 시험 응시 결과
CREATE TABLE IF NOT EXISTS exam_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES training_sessions(id) ON DELETE CASCADE,
  attempt_number INT DEFAULT 1,
  score SMALLINT NOT NULL,
  passed_yn BOOLEAN NOT NULL,
  answers JSONB NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. 수료 이력 (버전 스냅샷)
CREATE TABLE IF NOT EXISTS completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES training_sessions(id) UNIQUE,
  target_type_id INT REFERENCES target_types(id),
  course_id INT REFERENCES courses(id),
  course_version INT NOT NULL,
  exam_result_id UUID REFERENCES exam_results(id),
  completion_number VARCHAR(30) UNIQUE NOT NULL,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  score SMALLINT NOT NULL
);

-- 9. 설정값
CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(50) PRIMARY KEY,
  value VARCHAR(200) NOT NULL,
  description TEXT
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_sessions_phone_birth_name ON training_sessions(phone, birth_date, name);
CREATE INDEX IF NOT EXISTS idx_completions_expires ON completions(expires_at);
CREATE INDEX IF NOT EXISTS idx_watch_logs_session ON watch_logs(session_id);

-- ==========================================================
-- 초기 데이터 (시드)
-- ==========================================================

INSERT INTO target_types (code, label) VALUES
  ('TRUCK', '화물차 기사'),
  ('WORKER', '일반 작업자'),
  ('HEAVY', '중장비 기사')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app_settings (key, value, description) VALUES
  ('PASS_THRESHOLD', '7', '10문항 중 합격 최소 정답 수'),
  ('VALID_MONTHS', '6', '수료 유효 기간(개월)'),
  ('VIDEO_COMPLETE_RATE', '95', '영상 완료 판정 최소 시청률(%)'),
  ('COMPLETION_PREFIX', 'SF', '수료번호 접두사'),
  ('QUIZ_COUNT', '10', '시험 문항 수')
ON CONFLICT (key) DO NOTHING;

-- 샘플 교육 과정 (실제 운영 시 관리자 화면에서 수정)
INSERT INTO courses (target_type_id, title, version, is_active) VALUES
  ((SELECT id FROM target_types WHERE code = 'TRUCK'), '화물차 기사 안전보건교육', 1, TRUE),
  ((SELECT id FROM target_types WHERE code = 'WORKER'), '일반 작업자 안전보건교육', 1, TRUE),
  ((SELECT id FROM target_types WHERE code = 'HEAVY'), '중장비 기사 안전보건교육', 1, TRUE)
ON CONFLICT DO NOTHING;

-- 샘플 영상 (예시용. dQw4w9WgXcQ는 예시 YouTube ID — 실제 유튜브 Unlisted ID로 교체 필요)
INSERT INTO course_videos (course_id, title, youtube_video_id, duration_sec, sort_order)
SELECT c.id, c.title || ' - 1강', 'dQw4w9WgXcQ', 212, 1
FROM courses c
WHERE NOT EXISTS (SELECT 1 FROM course_videos cv WHERE cv.course_id = c.id);

-- 샘플 시험 문제 (각 대상별 10문항씩 생성 — 실제는 관리자 화면에서 작성)
DO $$
DECLARE
  tt_truck INT;
  tt_worker INT;
  tt_heavy INT;
  i INT;
BEGIN
  SELECT id INTO tt_truck FROM target_types WHERE code = 'TRUCK';
  SELECT id INTO tt_worker FROM target_types WHERE code = 'WORKER';
  SELECT id INTO tt_heavy FROM target_types WHERE code = 'HEAVY';

  IF (SELECT COUNT(*) FROM questions) = 0 THEN
    FOR i IN 1..10 LOOP
      INSERT INTO questions (target_type_id, question_text, option_1, option_2, option_3, option_4, correct_option, explanation)
      VALUES
        (tt_truck, '[화물차] 샘플 문제 ' || i || ': 공장 내 제한 속도는?', '10 km/h', '20 km/h', '30 km/h', '40 km/h', 1, '공장 내부는 10km/h 이하로 서행해야 합니다.'),
        (tt_worker, '[작업자] 샘플 문제 ' || i || ': 안전모 착용 의무 장소는?', '사무실', '휴게실', '작업장 전체', '식당', 3, '작업장 진입 시 반드시 안전모를 착용해야 합니다.'),
        (tt_heavy, '[중장비] 샘플 문제 ' || i || ': 중장비 작업 전 점검 항목이 아닌 것은?', '브레이크', '타이어/궤도', '연료량', '라디오 볼륨', 4, '장비 안전 점검 항목이 아닌 라디오 볼륨은 정답입니다.');
    END LOOP;
  END IF;
END $$;
