-- ============================================================================
-- 실제 교육 영상 15건 Seed (V1~V8 × 대상별)
-- ============================================================================
-- 실행 전 반드시 샘플 릭롤 영상 제거:
--   DELETE FROM course_videos;
-- ============================================================================

DO $$
DECLARE
  truck_course_id  INT;
  worker_course_id INT;
  heavy_course_id  INT;
BEGIN
  SELECT c.id INTO truck_course_id
  FROM courses c JOIN target_types t ON c.target_type_id = t.id
  WHERE t.code = 'TRUCK' AND c.is_active = TRUE
  ORDER BY c.version DESC LIMIT 1;

  SELECT c.id INTO worker_course_id
  FROM courses c JOIN target_types t ON c.target_type_id = t.id
  WHERE t.code = 'WORKER' AND c.is_active = TRUE
  ORDER BY c.version DESC LIMIT 1;

  SELECT c.id INTO heavy_course_id
  FROM courses c JOIN target_types t ON c.target_type_id = t.id
  WHERE t.code = 'HEAVY' AND c.is_active = TRUE
  ORDER BY c.version DESC LIMIT 1;

  IF truck_course_id IS NULL OR worker_course_id IS NULL OR heavy_course_id IS NULL THEN
    RAISE EXCEPTION '3개 대상(TRUCK/WORKER/HEAVY) 중 활성 course가 없음.';
  END IF;

  -- TRUCK (화물차 기사) : V1, V2, V3
  INSERT INTO course_videos (course_id, title, youtube_video_id, duration_sec, sort_order) VALUES
    (truck_course_id, '정문 출입·대기·계근대 이동 (자체 제작)',           'y-n9VIKl4Qk',  88, 1),
    (truck_course_id, '보호구 지급 및 착용',                                'DJWXc--CM_M', 164, 2),
    (truck_course_id, '화물차량 운반·하역 중 적재물 깔림 (재해사례)',      'AhXn5gHvAmk',  44, 3);

  -- WORKER (일반 작업자) : V1, V2, V4, V5, V6, V7
  INSERT INTO course_videos (course_id, title, youtube_video_id, duration_sec, sort_order) VALUES
    (worker_course_id, '정문 출입·대기·계근대 이동 (자체 제작)',          'y-n9VIKl4Qk',  88, 1),
    (worker_course_id, '보호구 지급 및 착용',                               'DJWXc--CM_M', 164, 2),
    (worker_course_id, '위험작업 승인의 이해',                              'sUsShurHSgg', 120, 3),
    (worker_course_id, '기계 점검·보수 시 작업안전',                        'JsjFFCjJ-6E', 152, 4),
    (worker_course_id, '제철소 용해 작업 수증기 폭발 예방 (알루미늄 관련)', 'nQJKrtpLcBE',  35, 5),
    (worker_course_id, '고소작업대 작업 안전 주의사항',                     'Xtfn5ltPXvw', 194, 6);

  -- HEAVY (중장비 기사) : V1, V2, V3, V4, V7, V8
  INSERT INTO course_videos (course_id, title, youtube_video_id, duration_sec, sort_order) VALUES
    (heavy_course_id, '정문 출입·대기·계근대 이동 (자체 제작)',          'y-n9VIKl4Qk',  88, 1),
    (heavy_course_id, '보호구 지급 및 착용',                               'DJWXc--CM_M', 164, 2),
    (heavy_course_id, '화물차량 운반·하역 중 적재물 깔림 (재해사례)',     'AhXn5gHvAmk',  44, 3),
    (heavy_course_id, '위험작업 승인의 이해',                              'sUsShurHSgg', 120, 4),
    (heavy_course_id, '고소작업대 작업 안전 주의사항',                     'Xtfn5ltPXvw', 194, 5),
    (heavy_course_id, '지게차 작업 안전',                                  'XkofzBvHKIA', 203, 6);

  RAISE NOTICE '영상 등록 완료: TRUCK 3개 / WORKER 6개 / HEAVY 6개 (총 15건)';
END $$;
