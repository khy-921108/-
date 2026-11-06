-- ==========================================================
-- 022: 관리자 기록 관리 — 업체 숨김/삭제, 수료 기록 수정·삭제, 작업허가 삭제
--  · 신규 추가만. 기존 행의 값은 이 파일을 실행해도 바뀌지 않는다.
--  · 수정·삭제는 아래 SQL 함수 안에서 한 트랜잭션으로 처리한다.
--    로그 저장이 실패하면 데이터도 바뀌지 않는다. Storage 파일 삭제만 API 라우트가 한다.
--  · 여러 번 실행해도 안전(IF NOT EXISTS / CREATE OR REPLACE).
-- ⚠️ 이 SQL 을 Supabase 에서 먼저 실행한 뒤 코드를 배포할 것. (기존 규칙)
-- ==========================================================


-- ----------------------------------------------------------
-- [실행 전 확인] 아래 SELECT 를 먼저 단독 실행한다.
--   결과 = equipment, field_additions, field_joins, rollback_logs 4줄이어야 정상.
--   4줄이 안 나오면 여기서 멈추고 알릴 것(016·017·020·021 미실행 가능성).
--   (전체를 한 번에 실행해도 아래 DO 블록이 멈춰 주지만, 화면에는 마지막 결과만 보인다.)
-- ----------------------------------------------------------
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'work_permits'
  AND column_name IN ('rollback_logs', 'equipment', 'field_joins', 'field_additions')
ORDER BY column_name;

DO $$
DECLARE
  v_found INT;
BEGIN
  SELECT count(*) INTO v_found
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'work_permits'
    AND column_name IN ('rollback_logs', 'equipment', 'field_joins', 'field_additions');
  IF v_found <> 4 THEN
    RAISE EXCEPTION 'work_permits 컬럼 부족(%/4). 016·017·020·021 실행 여부를 확인할 것.', v_found;
  END IF;
END $$;


-- ----------------------------------------------------------
-- 1. 업체 숨김 시각 (값이 있으면 관리자 목록·통계·엑셀에서 제외, status 는 DISABLED 유지)
-- ----------------------------------------------------------
ALTER TABLE companies ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;


-- ----------------------------------------------------------
-- 2. 로그 표 2종 — RLS 켜기, 정책 없음. 수정·삭제 권한을 주지 않는다.
--    session_id·permit_id 에 FK 를 걸지 않는다(원본이 지워져도 로그는 남아야 한다).
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS training_record_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  completion_number VARCHAR(30),
  action VARCHAR(10) NOT NULL CHECK (action IN ('EDIT', 'DELETE')),
  reason TEXT NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB,
  actor VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_training_record_logs_session ON training_record_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_training_record_logs_number ON training_record_logs(completion_number);
CREATE INDEX IF NOT EXISTS idx_training_record_logs_created ON training_record_logs(created_at);

CREATE TABLE IF NOT EXISTS work_permit_delete_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  permit_id UUID NOT NULL,
  permit_number VARCHAR(20) NOT NULL,
  company_name VARCHAR(200),
  reason TEXT NOT NULL,
  "before" JSONB NOT NULL,
  actor VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_work_permit_delete_logs_created ON work_permit_delete_logs(created_at);

ALTER TABLE training_record_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_permit_delete_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON training_record_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON work_permit_delete_logs FROM PUBLIC, anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON training_record_logs FROM service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON work_permit_delete_logs FROM service_role;
GRANT SELECT, INSERT ON training_record_logs TO service_role;
GRANT SELECT, INSERT ON work_permit_delete_logs TO service_role;


-- ----------------------------------------------------------
-- 3. 업체 삭제
--    p_preview=TRUE  : 연결 기록 수만 돌려준다(확인창용). 아무것도 바꾸지 않는다.
--    p_preview=FALSE : 연결 기록 0건 → 실제 삭제(인원·문서 메타는 CASCADE),
--                      1건 이상 → archived_at 만 기록(숨김).
--    FOR UPDATE 잠금으로 세는 사이에 새 연결 기록이 끼어드는 것을 막는다.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_delete_company(p_company_id UUID, p_preview BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company companies%ROWTYPE;
  v_sessions INT;
  v_permits INT;
  v_participants INT;
  v_pledges INT;
  v_undertakings INT;
  v_total INT;
  v_counts JSONB;
  v_paths JSONB;
BEGIN
  IF p_preview THEN
    SELECT * INTO v_company FROM companies WHERE id = p_company_id;
  ELSE
    SELECT * INTO v_company FROM companies WHERE id = p_company_id FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'NOT_FOUND');
  END IF;
  IF v_company.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'ALREADY_ARCHIVED');
  END IF;
  IF v_company.status <> 'DISABLED' THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'NOT_DISABLED');
  END IF;

  SELECT count(*) INTO v_sessions FROM training_sessions WHERE company_id = p_company_id;
  SELECT count(*) INTO v_permits FROM work_permits WHERE request_company_id = p_company_id;
  SELECT count(*) INTO v_participants FROM work_permit_participants WHERE company_id = p_company_id;
  SELECT count(*) INTO v_pledges FROM safety_pledges WHERE company_id = p_company_id;
  SELECT count(*) INTO v_undertakings FROM company_undertakings WHERE company_id = p_company_id;

  v_total := v_sessions + v_permits + v_participants + v_pledges + v_undertakings;
  v_counts := jsonb_build_object(
    'sessions', v_sessions,
    'permits', v_permits,
    'participants', v_participants,
    'pledges', v_pledges,
    'undertakings', v_undertakings
  );

  IF p_preview THEN
    RETURN jsonb_build_object(
      'ok', TRUE, 'preview', TRUE, 'name', v_company.name, 'counts', v_counts, 'total', v_total
    );
  END IF;

  IF v_total = 0 THEN
    SELECT COALESCE(jsonb_agg(storage_path), '[]'::jsonb) INTO v_paths
    FROM company_documents WHERE company_id = p_company_id;

    DELETE FROM companies WHERE id = p_company_id;

    RETURN jsonb_build_object(
      'ok', TRUE, 'action', 'DELETED', 'name', v_company.name, 'counts', v_counts,
      'total', v_total, 'paths', v_paths
    );
  END IF;

  UPDATE companies SET archived_at = NOW() WHERE id = p_company_id;

  RETURN jsonb_build_object(
    'ok', TRUE, 'action', 'ARCHIVED', 'name', v_company.name, 'counts', v_counts,
    'total', v_total, 'paths', '[]'::jsonb
  );
END;
$$;


-- ----------------------------------------------------------
-- 4. 수료 기록 수정
--    · 같은 사람(이름+생년월일+연락처 일치)의 세션을 함께 수정.
--    · 소속 변경은 그중 현재 업체 소속 세션만.
--    · 차량번호는 선택한 세션 + 같은 사람의 "같은 차량번호" 세션만
--      (같은 사람이 다른 차량으로 받은 교육은 덮어쓰지 않는다).
--    · 절대 안 건드림: completions, safety_pledges, company_undertakings,
--      work_permit_participants.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_edit_training_record(
  p_session_id UUID,
  p_name TEXT,
  p_birth_date DATE,
  p_phone TEXT,
  p_vehicle_number TEXT,
  p_company_id UUID,
  p_reason TEXT,
  p_actor TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target training_sessions%ROWTYPE;
  v_company companies%ROWTYPE;
  v_member company_members%ROWTYPE;
  v_name TEXT := trim(p_name);
  v_phone TEXT := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  v_vehicle TEXT := NULLIF(trim(COALESCE(p_vehicle_number, '')), '');
  v_old_phone TEXT;
  v_same_ids UUID[];
  v_move_ids UUID[] := '{}';
  v_company_ids UUID[];
  v_member_ids UUID[];
  v_person_changed BOOLEAN;
  v_vehicle_changed BOOLEAN;
  v_moving BOOLEAN := FALSE;
  v_merged INT := 0;
  v_removed INT := 0;
  v_moved INT := 0;
  v_before JSONB;
  v_after JSONB;
  v_completion_number TEXT;
BEGIN
  IF COALESCE(trim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'NO_REASON');
  END IF;

  SELECT * INTO v_target FROM training_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'NOT_FOUND');
  END IF;

  v_old_phone := regexp_replace(COALESCE(v_target.phone, ''), '[^0-9]', '', 'g');
  v_person_changed := trim(v_target.name) IS DISTINCT FROM v_name
    OR v_target.birth_date IS DISTINCT FROM p_birth_date
    OR v_old_phone IS DISTINCT FROM v_phone;
  v_vehicle_changed := NULLIF(trim(COALESCE(v_target.vehicle_number, '')), '') IS DISTINCT FROM v_vehicle;

  -- 소속 변경 대상 업체 확인(사용중지·숨김 선택 불가)
  IF p_company_id IS NOT NULL AND p_company_id IS DISTINCT FROM v_target.company_id THEN
    SELECT * INTO v_company FROM companies WHERE id = p_company_id FOR SHARE;
    IF NOT FOUND OR v_company.status = 'DISABLED' OR v_company.archived_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', FALSE, 'code', 'COMPANY_NOT_ALLOWED');
    END IF;
    v_moving := TRUE;
  END IF;

  IF NOT v_person_changed AND NOT v_vehicle_changed AND NOT v_moving THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'NO_CHANGE');
  END IF;

  -- 같은 사람의 세션 전체 잠금
  SELECT array_agg(s.id) INTO v_same_ids
  FROM (
    SELECT id FROM training_sessions
    WHERE trim(name) = trim(v_target.name)
      AND birth_date = v_target.birth_date
      AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = v_old_phone
    ORDER BY id
    FOR UPDATE
  ) s;

  SELECT array_agg(DISTINCT company_id) INTO v_company_ids
  FROM training_sessions
  WHERE id = ANY(v_same_ids) AND company_id IS NOT NULL;

  -- 그 업체들의 명단에 있는 같은 사람 행 잠금
  SELECT COALESCE(array_agg(m.id), '{}') INTO v_member_ids
  FROM (
    SELECT id FROM company_members
    WHERE company_id = ANY(COALESCE(v_company_ids, '{}'::UUID[]))
      AND trim(name) = trim(v_target.name)
      AND birth_date = v_target.birth_date
      AND normalized_phone = v_old_phone
    ORDER BY id
    FOR UPDATE
  ) m;

  IF v_moving THEN
    SELECT COALESCE(array_agg(id), '{}') INTO v_move_ids
    FROM training_sessions
    WHERE id = ANY(v_same_ids)
      AND company_id IS NOT DISTINCT FROM v_target.company_id
      AND (v_target.company_id IS NOT NULL OR trim(affiliation) = trim(v_target.affiliation));
  END IF;

  -- 수정 전 스냅샷
  v_before := jsonb_build_object(
    'sessions', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at) FROM training_sessions t WHERE t.id = ANY(v_same_ids)),
    'members', (SELECT COALESCE(jsonb_agg(to_jsonb(m)), '[]'::jsonb) FROM company_members m WHERE m.id = ANY(v_member_ids))
  );

  -- 이름·생년월일·연락처
  IF v_person_changed THEN
    UPDATE training_sessions
    SET name = v_name, birth_date = p_birth_date, phone = v_phone
    WHERE id = ANY(v_same_ids);

    FOR v_member IN SELECT * FROM company_members WHERE id = ANY(v_member_ids) ORDER BY id LOOP
      IF EXISTS (
        SELECT 1 FROM company_members x
        WHERE x.company_id = v_member.company_id
          AND x.id <> v_member.id
          AND trim(x.name) = v_name
          AND x.birth_date = p_birth_date
          AND x.normalized_phone = v_phone
      ) THEN
        -- UNIQUE 충돌: 이미 있는 행을 남기고 이 행을 제거
        DELETE FROM company_members WHERE id = v_member.id;
        v_merged := v_merged + 1;
      ELSE
        UPDATE company_members
        SET name = v_name, birth_date = p_birth_date, phone = v_phone, normalized_phone = v_phone
        WHERE id = v_member.id;
      END IF;
    END LOOP;
  END IF;

  -- 차량번호
  IF v_vehicle_changed THEN
    UPDATE training_sessions
    SET vehicle_number = v_vehicle
    WHERE id = p_session_id
       OR (id = ANY(v_same_ids) AND v_target.vehicle_number IS NOT NULL AND vehicle_number = v_target.vehicle_number);

    IF v_target.company_id IS NOT NULL THEN
      UPDATE company_members
      SET vehicle_number = v_vehicle
      WHERE company_id = v_target.company_id
        AND trim(name) = v_name
        AND birth_date = p_birth_date
        AND normalized_phone = v_phone
        AND vehicle_number IS NOT DISTINCT FROM v_target.vehicle_number;
    END IF;
  END IF;

  -- 소속 변경 (completions 는 건드리지 않음)
  IF v_moving THEN
    UPDATE training_sessions
    SET company_id = p_company_id, affiliation = left(v_company.name, 100)
    WHERE id = ANY(v_move_ids);

    IF v_target.company_id IS NOT NULL THEN
      FOR v_member IN
        SELECT * FROM company_members
        WHERE company_id = v_target.company_id
          AND trim(name) = v_name
          AND birth_date = p_birth_date
          AND normalized_phone = v_phone
        ORDER BY id
        FOR UPDATE
      LOOP
        IF EXISTS (
          SELECT 1 FROM company_members x
          WHERE x.company_id = p_company_id
            AND trim(x.name) = v_name
            AND x.birth_date = p_birth_date
            AND x.normalized_phone = v_phone
        ) THEN
          -- 새 업체에 같은 사람이 이미 있으면 옛 행만 제거
          DELETE FROM company_members WHERE id = v_member.id;
          v_removed := v_removed + 1;
        ELSE
          UPDATE company_members SET company_id = p_company_id WHERE id = v_member.id;
          v_moved := v_moved + 1;
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- 수정 후 스냅샷 + 로그 (실패하면 위 변경도 함께 취소된다)
  v_after := jsonb_build_object(
    'sessions', (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.created_at) FROM training_sessions t WHERE t.id = ANY(v_same_ids)),
    'members', (
      SELECT COALESCE(jsonb_agg(to_jsonb(m)), '[]'::jsonb) FROM company_members m
      WHERE m.company_id = ANY(COALESCE(v_company_ids, '{}'::UUID[]) || CASE WHEN v_moving THEN ARRAY[p_company_id] ELSE '{}'::UUID[] END)
        AND trim(m.name) = v_name
        AND m.birth_date = p_birth_date
        AND m.normalized_phone = v_phone
    )
  );

  SELECT completion_number INTO v_completion_number FROM completions WHERE session_id = p_session_id;

  INSERT INTO training_record_logs (session_id, completion_number, action, reason, "before", "after", actor)
  VALUES (p_session_id, v_completion_number, 'EDIT', trim(p_reason), v_before, v_after, p_actor);

  RETURN jsonb_build_object(
    'ok', TRUE,
    'personChanged', v_person_changed,
    'vehicleChanged', v_vehicle_changed,
    'companyChanged', v_moving,
    'sessionCount', COALESCE(array_length(v_same_ids, 1), 0),
    'movedSessionCount', COALESCE(array_length(v_move_ids, 1), 0),
    'membersMerged', v_merged,
    'membersRemoved', v_removed,
    'membersMoved', v_moved
  );
END;
$$;


-- ----------------------------------------------------------
-- 5. 수료 기록(세션) 삭제 — 선택한 세션 1건만
--    · 허가서에 쓰인 세션은 거부(FOR UPDATE 가 참여자 추가 2경로의 FK 삽입과 충돌해
--      검사와 삭제 사이에 참여자가 새로 붙는 일을 막는다).
--    · 세션·수료·시험결과·시청기록 전체를 로그에 저장한 뒤
--      completions → training_sessions 순서로 삭제(exam_results, watch_logs 는 CASCADE).
--    · company_members 행은 지우지 않는다.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_delete_training_record(
  p_session_id UUID,
  p_reason TEXT,
  p_actor TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session training_sessions%ROWTYPE;
  v_completion completions%ROWTYPE;
  v_permits JSONB;
  v_before JSONB;
BEGIN
  IF COALESCE(trim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'NO_REASON');
  END IF;

  SELECT * INTO v_session FROM training_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'NOT_FOUND');
  END IF;

  SELECT COALESCE(jsonb_agg(DISTINCT wp.permit_number), '[]'::jsonb) INTO v_permits
  FROM work_permit_participants pp
  LEFT JOIN work_permits wp ON wp.id = pp.work_permit_id
  WHERE pp.session_id = p_session_id;

  IF EXISTS (SELECT 1 FROM work_permit_participants WHERE session_id = p_session_id) THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'IN_USE', 'permits', v_permits);
  END IF;

  SELECT * INTO v_completion FROM completions WHERE session_id = p_session_id FOR UPDATE;

  v_before := jsonb_build_object(
    'session', to_jsonb(v_session),
    'completion', CASE WHEN v_completion.id IS NULL THEN NULL ELSE to_jsonb(v_completion) END,
    'examResults', (SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.attempted_at), '[]'::jsonb) FROM exam_results e WHERE e.session_id = p_session_id),
    'watchLogs', (SELECT COALESCE(jsonb_agg(to_jsonb(w)), '[]'::jsonb) FROM watch_logs w WHERE w.session_id = p_session_id)
  );

  INSERT INTO training_record_logs (session_id, completion_number, action, reason, "before", "after", actor)
  VALUES (p_session_id, v_completion.completion_number, 'DELETE', trim(p_reason), v_before, NULL, p_actor);

  DELETE FROM completions WHERE session_id = p_session_id;
  DELETE FROM training_sessions WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'name', v_session.name,
    'completionNumber', v_completion.completion_number
  );
END;
$$;


-- ----------------------------------------------------------
-- 6. 작업허가 삭제 — 건별 판정, 조건에 맞는 건만 삭제
--    안 맞는 건은 그대로 두고 사유를 돌려준다. 문자·알림 없음.
--    참여자는 CASCADE. safety_pledges·company_undertakings 는 건드리지 않음.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_delete_work_permits(
  p_ids UUID[],
  p_reason TEXT,
  p_actor TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
  v_p work_permits%ROWTYPE;
  v_tbm JSONB;
  v_reasons TEXT[];
  v_participants JSONB;
  v_deleted JSONB := '[]'::jsonb;
  v_refused JSONB := '[]'::jsonb;
BEGIN
  IF COALESCE(trim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'NO_REASON');
  END IF;

  FOR v_id IN SELECT DISTINCT i FROM unnest(p_ids) AS i ORDER BY i LOOP
    SELECT * INTO v_p FROM work_permits WHERE id = v_id FOR UPDATE;

    IF NOT FOUND THEN
      v_refused := v_refused || jsonb_build_array(jsonb_build_object(
        'id', v_id, 'permitNumber', NULL, 'reasons', jsonb_build_array('허가서를 찾을 수 없음')
      ));
      CONTINUE;
    END IF;

    v_reasons := ARRAY[]::TEXT[];
    v_tbm := COALESCE(v_p.tbm, '{}'::jsonb);

    IF COALESCE(v_p.status, '') NOT IN ('SUBMITTED', 'REJECTED') THEN
      v_reasons := array_append(v_reasons, '대기·반려 상태가 아님');
    END IF;
    IF COALESCE(v_p.issuer_signature, '') <> '' THEN
      v_reasons := array_append(v_reasons, '1차 승인 서명 있음');
    END IF;
    IF COALESCE(v_tbm #>> '{witness,signature}', '') <> '' THEN
      v_reasons := array_append(v_reasons, '2차 입회 서명 있음');
    END IF;
    IF v_p.started_at IS NOT NULL THEN
      v_reasons := array_append(v_reasons, '작업 개시됨');
    END IF;
    IF jsonb_typeof(v_p.completion) = 'object' THEN
      IF EXISTS (
        SELECT 1 FROM jsonb_each_text(v_p.completion) e
        WHERE e.key ILIKE '%signature%' AND COALESCE(e.value, '') <> ''
      ) THEN
        v_reasons := array_append(v_reasons, '종료 서명 있음');
      END IF;
    END IF;
    IF jsonb_typeof(v_p.dept_confirmations) = 'object' THEN
      IF EXISTS (
        SELECT 1 FROM jsonb_each(v_p.dept_confirmations) e
        WHERE COALESCE(e.value ->> 'signature', '') <> ''
      ) THEN
        v_reasons := array_append(v_reasons, '별지 현장확인 서명 있음');
      END IF;
    END IF;
    IF COALESCE(v_tbm -> 'photos', '[]'::jsonb) NOT IN ('[]'::jsonb, 'null'::jsonb) THEN
      v_reasons := array_append(v_reasons, 'TBM 사진 있음');
    END IF;
    IF COALESCE(v_tbm -> 'confirmations', '{}'::jsonb) NOT IN ('{}'::jsonb, '[]'::jsonb, 'null'::jsonb) THEN
      v_reasons := array_append(v_reasons, 'TBM 서명 있음');
    END IF;
    IF COALESCE(v_p.field_joins, '[]'::jsonb) NOT IN ('[]'::jsonb, 'null'::jsonb) THEN
      v_reasons := array_append(v_reasons, '현장 합류 기록 있음');
    END IF;
    IF COALESCE(v_p.field_additions, '[]'::jsonb) NOT IN ('[]'::jsonb, 'null'::jsonb) THEN
      v_reasons := array_append(v_reasons, '현장 추가 기록 있음');
    END IF;
    IF COALESCE(v_p.equipment_arrivals, '[]'::jsonb) NOT IN ('[]'::jsonb, 'null'::jsonb) THEN
      v_reasons := array_append(v_reasons, '장비 도착 기록 있음');
    END IF;

    IF COALESCE(array_length(v_reasons, 1), 0) > 0 THEN
      v_refused := v_refused || jsonb_build_array(jsonb_build_object(
        'id', v_p.id, 'permitNumber', v_p.permit_number, 'reasons', to_jsonb(v_reasons)
      ));
      CONTINUE;
    END IF;

    SELECT COALESCE(jsonb_agg(to_jsonb(pp) ORDER BY pp.sort_order), '[]'::jsonb) INTO v_participants
    FROM work_permit_participants pp WHERE pp.work_permit_id = v_id;

    INSERT INTO work_permit_delete_logs (permit_id, permit_number, company_name, reason, "before", actor)
    VALUES (
      v_p.id, v_p.permit_number, v_p.request_company_name, trim(p_reason),
      jsonb_build_object('permit', to_jsonb(v_p), 'participants', v_participants),
      p_actor
    );

    DELETE FROM work_permits WHERE id = v_id;

    v_deleted := v_deleted || jsonb_build_array(jsonb_build_object(
      'id', v_p.id, 'permitNumber', v_p.permit_number
    ));
  END LOOP;

  RETURN jsonb_build_object('ok', TRUE, 'deleted', v_deleted, 'refused', v_refused);
END;
$$;


-- ----------------------------------------------------------
-- 7. 함수 실행 권한 — 서버(service_role)만
-- ----------------------------------------------------------
REVOKE EXECUTE ON FUNCTION admin_delete_company(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_edit_training_record(UUID, TEXT, DATE, TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_delete_training_record(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_delete_work_permits(UUID[], TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION admin_delete_company(UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION admin_edit_training_record(UUID, TEXT, DATE, TEXT, TEXT, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION admin_delete_training_record(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION admin_delete_work_permits(UUID[], TEXT, TEXT) TO service_role;
