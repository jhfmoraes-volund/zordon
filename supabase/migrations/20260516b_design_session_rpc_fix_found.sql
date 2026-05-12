-- Fix: 20260516 RPCs usavam IF NOT FOUND após EXECUTE dynamic — não confiável.
-- Troca por GET DIAGNOSTICS rowcount; valida existência da row antes do dispatch.

BEGIN;

CREATE OR REPLACE FUNCTION persona_journey_upsert(
  p_persona_id uuid,
  p_kind text,           -- 'asIs' | 'toBe'
  p_step jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_col text;
  v_id text;
  v_step jsonb;
  v_exists boolean;
  v_persona_exists boolean;
  v_rowcount int;
BEGIN
  v_col := CASE p_kind WHEN 'asIs' THEN 'asIsSteps' WHEN 'toBe' THEN 'toBeSteps' END;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'invalid kind: %, expected asIs|toBe', p_kind;
  END IF;

  -- existência da persona (preempt RAISE no dispatch)
  SELECT EXISTS (SELECT 1 FROM "DesignSessionPersona" WHERE id = p_persona_id)
    INTO v_persona_exists;
  IF NOT v_persona_exists THEN
    RAISE EXCEPTION 'persona % not found', p_persona_id;
  END IF;

  v_id := COALESCE(NULLIF(p_step->>'id', ''), gen_random_uuid()::text);
  v_step := jsonb_set(p_step, '{id}', to_jsonb(v_id));

  -- existência do step (para decidir update vs append)
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(%I, ''[]''::jsonb)) s WHERE s->>''id'' = $1) FROM "DesignSessionPersona" WHERE id = $2',
    v_col
  ) INTO v_exists USING v_id, p_persona_id;

  IF v_exists THEN
    EXECUTE format($f$
      UPDATE "DesignSessionPersona"
      SET %I = COALESCE(
            (SELECT jsonb_agg(CASE WHEN s->>'id' = $1 THEN $2 ELSE s END)
             FROM jsonb_array_elements(%I) s),
            '[]'::jsonb
          ),
          "updatedAt" = now()
      WHERE id = $3
    $f$, v_col, v_col) USING v_id, v_step, p_persona_id;
  ELSE
    EXECUTE format($f$
      UPDATE "DesignSessionPersona"
      SET %I = COALESCE(%I, '[]'::jsonb) || $1::jsonb,
          "updatedAt" = now()
      WHERE id = $2
    $f$, v_col, v_col) USING jsonb_build_array(v_step), p_persona_id;
  END IF;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    RAISE EXCEPTION 'persona_journey_upsert: no row affected for persona %', p_persona_id;
  END IF;

  RETURN v_step;
END $$;

CREATE OR REPLACE FUNCTION scope_item_upsert(
  p_session_id uuid,
  p_bucket text,
  p_item jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_col text;
  v_id text;
  v_item jsonb;
  v_exists boolean;
  v_rowcount int;
BEGIN
  v_col := CASE p_bucket
    WHEN 'inScope' THEN 'inScope'
    WHEN 'outOfScope' THEN 'outOfScope'
    WHEN 'does' THEN 'does'
    WHEN 'doesNot' THEN 'doesNot'
  END;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'invalid bucket: %, expected inScope|outOfScope|does|doesNot', p_bucket;
  END IF;

  v_id := COALESCE(NULLIF(p_item->>'id', ''), gen_random_uuid()::text);
  v_item := jsonb_set(p_item, '{id}', to_jsonb(v_id));

  INSERT INTO "DesignSessionScope" ("sessionId") VALUES (p_session_id)
    ON CONFLICT ("sessionId") DO NOTHING;

  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(%I, ''[]''::jsonb)) s WHERE s->>''id'' = $1) FROM "DesignSessionScope" WHERE "sessionId" = $2',
    v_col
  ) INTO v_exists USING v_id, p_session_id;

  IF v_exists THEN
    EXECUTE format($f$
      UPDATE "DesignSessionScope"
      SET %I = COALESCE(
            (SELECT jsonb_agg(CASE WHEN s->>'id' = $1 THEN $2 ELSE s END)
             FROM jsonb_array_elements(%I) s),
            '[]'::jsonb
          ),
          "updatedAt" = now()
      WHERE "sessionId" = $3
    $f$, v_col, v_col) USING v_id, v_item, p_session_id;
  ELSE
    EXECUTE format($f$
      UPDATE "DesignSessionScope"
      SET %I = COALESCE(%I, '[]'::jsonb) || $1::jsonb,
          "updatedAt" = now()
      WHERE "sessionId" = $2
    $f$, v_col, v_col) USING jsonb_build_array(v_item), p_session_id;
  END IF;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    RAISE EXCEPTION 'scope_item_upsert: no row affected for session %', p_session_id;
  END IF;

  RETURN v_item;
END $$;

CREATE OR REPLACE FUNCTION tech_specs_item_upsert(
  p_session_id uuid,
  p_kind text,
  p_item jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_col text;
  v_id text;
  v_item jsonb;
  v_exists boolean;
  v_rowcount int;
BEGIN
  v_col := CASE p_kind WHEN 'integration' THEN 'integrations' WHEN 'rule' THEN 'rules' END;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'invalid kind: %, expected integration|rule', p_kind;
  END IF;

  v_id := COALESCE(NULLIF(p_item->>'id', ''), gen_random_uuid()::text);
  v_item := jsonb_set(p_item, '{id}', to_jsonb(v_id));

  INSERT INTO "DesignSessionTechnicalSpecs" ("sessionId") VALUES (p_session_id)
    ON CONFLICT ("sessionId") DO NOTHING;

  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(%I, ''[]''::jsonb)) s WHERE s->>''id'' = $1) FROM "DesignSessionTechnicalSpecs" WHERE "sessionId" = $2',
    v_col
  ) INTO v_exists USING v_id, p_session_id;

  IF v_exists THEN
    EXECUTE format($f$
      UPDATE "DesignSessionTechnicalSpecs"
      SET %I = COALESCE(
            (SELECT jsonb_agg(CASE WHEN s->>'id' = $1 THEN $2 ELSE s END)
             FROM jsonb_array_elements(%I) s),
            '[]'::jsonb
          ),
          "updatedAt" = now()
      WHERE "sessionId" = $3
    $f$, v_col, v_col) USING v_id, v_item, p_session_id;
  ELSE
    EXECUTE format($f$
      UPDATE "DesignSessionTechnicalSpecs"
      SET %I = COALESCE(%I, '[]'::jsonb) || $1::jsonb,
          "updatedAt" = now()
      WHERE "sessionId" = $2
    $f$, v_col, v_col) USING jsonb_build_array(v_item), p_session_id;
  END IF;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    RAISE EXCEPTION 'tech_specs_item_upsert: no row affected for session %', p_session_id;
  END IF;

  RETURN v_item;
END $$;

COMMIT;
