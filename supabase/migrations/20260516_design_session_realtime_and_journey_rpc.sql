-- Vitor normalization v2 — Fase 1
-- 1. Habilita Postgres realtime nas 9 tabelas editáveis pelo board.
-- 2. RPCs atômicas pra journey steps (persona.asIsSteps/toBeSteps jsonb) e
--    scope items (scope.inScope/outOfScope/does/doesNot jsonb).
--
-- Plano: docs/vitor-normalization-plan-v2.md §3.2 + §5.
-- Padrão de publication: 20260507_telegram_integration.sql:34-43.

BEGIN;

-- ============================================================
-- 1. REPLICA IDENTITY FULL + publication
-- ============================================================

ALTER TABLE "DesignSessionProductVision" REPLICA IDENTITY FULL;
ALTER TABLE "DesignSessionScope" REPLICA IDENTITY FULL;
ALTER TABLE "DesignSessionPersona" REPLICA IDENTITY FULL;
ALTER TABLE "DesignSessionBrainstormFeature" REPLICA IDENTITY FULL;
ALTER TABLE "DesignSessionPriorityItem" REPLICA IDENTITY FULL;
ALTER TABLE "DesignSessionRisk" REPLICA IDENTITY FULL;
ALTER TABLE "DesignSessionGap" REPLICA IDENTITY FULL;
ALTER TABLE "DesignSessionTechnicalSpecs" REPLICA IDENTITY FULL;
ALTER TABLE "DesignSessionHypothesis" REPLICA IDENTITY FULL;

-- Add table to publication idempotently. ADD TABLE não suporta IF NOT EXISTS
-- até PG 17; usa-se DO block per-table pra capturar duplicate_object.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'DesignSessionProductVision',
    'DesignSessionScope',
    'DesignSessionPersona',
    'DesignSessionBrainstormFeature',
    'DesignSessionPriorityItem',
    'DesignSessionRisk',
    'DesignSessionGap',
    'DesignSessionTechnicalSpecs',
    'DesignSessionHypothesis'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- ============================================================
-- 2. RPC: persona journey step upsert/delete
--
-- asIsSteps / toBeSteps são jsonb arrays de { id, description?, painOrGain?, ... }.
-- Upsert: se p_step tem id existente no array, substitui; senão, append.
-- Sempre garante id no retorno (gera uuid se não vier).
-- ============================================================

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
  v_result jsonb;
BEGIN
  v_col := CASE p_kind WHEN 'asIs' THEN 'asIsSteps' WHEN 'toBe' THEN 'toBeSteps' END;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'invalid kind: %, expected asIs|toBe', p_kind;
  END IF;

  v_id := COALESCE(NULLIF(p_step->>'id', ''), gen_random_uuid()::text);
  v_step := jsonb_set(p_step, '{id}', to_jsonb(v_id));

  -- check existence then dispatch update vs append
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'persona % not found', p_persona_id;
  END IF;

  v_result := v_step;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION persona_journey_delete(
  p_persona_id uuid,
  p_kind text,
  p_step_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_col text;
  v_before int;
  v_after int;
BEGIN
  v_col := CASE p_kind WHEN 'asIs' THEN 'asIsSteps' WHEN 'toBe' THEN 'toBeSteps' END;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'invalid kind: %, expected asIs|toBe', p_kind;
  END IF;

  EXECUTE format(
    'SELECT jsonb_array_length(COALESCE(%I, ''[]''::jsonb)) FROM "DesignSessionPersona" WHERE id = $1',
    v_col
  ) INTO v_before USING p_persona_id;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'persona % not found', p_persona_id;
  END IF;

  EXECUTE format($f$
    UPDATE "DesignSessionPersona"
    SET %I = COALESCE(
          (SELECT jsonb_agg(s) FROM jsonb_array_elements(%I) s WHERE s->>'id' <> $1),
          '[]'::jsonb
        ),
        "updatedAt" = now()
    WHERE id = $2
  $f$, v_col, v_col) USING p_step_id, p_persona_id;

  EXECUTE format(
    'SELECT jsonb_array_length(COALESCE(%I, ''[]''::jsonb)) FROM "DesignSessionPersona" WHERE id = $1',
    v_col
  ) INTO v_after USING p_persona_id;

  RETURN v_after < v_before;
END $$;

-- ============================================================
-- 3. RPC: scope item upsert/delete
--
-- DesignSessionScope tem 4 jsonb arrays: inScope, outOfScope, does, doesNot.
-- Item shape: { id, text, ... } (passthrough).
-- ============================================================

CREATE OR REPLACE FUNCTION scope_item_upsert(
  p_session_id uuid,
  p_bucket text,         -- 'inScope' | 'outOfScope' | 'does' | 'doesNot'
  p_item jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_col text;
  v_id text;
  v_item jsonb;
  v_exists boolean;
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

  -- Garante 1 row pra sessão (scope é 1:1)
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

  RETURN v_item;
END $$;

CREATE OR REPLACE FUNCTION scope_item_delete(
  p_session_id uuid,
  p_bucket text,
  p_item_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_col text;
  v_before int;
  v_after int;
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

  EXECUTE format(
    'SELECT jsonb_array_length(COALESCE(%I, ''[]''::jsonb)) FROM "DesignSessionScope" WHERE "sessionId" = $1',
    v_col
  ) INTO v_before USING p_session_id;

  IF v_before IS NULL THEN
    -- não tem row → nada pra deletar
    RETURN false;
  END IF;

  EXECUTE format($f$
    UPDATE "DesignSessionScope"
    SET %I = COALESCE(
          (SELECT jsonb_agg(s) FROM jsonb_array_elements(%I) s WHERE s->>'id' <> $1),
          '[]'::jsonb
        ),
        "updatedAt" = now()
    WHERE "sessionId" = $2
  $f$, v_col, v_col) USING p_item_id, p_session_id;

  EXECUTE format(
    'SELECT jsonb_array_length(COALESCE(%I, ''[]''::jsonb)) FROM "DesignSessionScope" WHERE "sessionId" = $1',
    v_col
  ) INTO v_after USING p_session_id;

  RETURN v_after < v_before;
END $$;

-- ============================================================
-- 4. RPC: technical specs integrations/rules upsert+delete
--
-- TechnicalSpecs.integrations / .rules são jsonb arrays.
-- Shape passthrough (id, text/name/url/...) — manter consistente com REST.
-- ============================================================

CREATE OR REPLACE FUNCTION tech_specs_item_upsert(
  p_session_id uuid,
  p_kind text,           -- 'integration' | 'rule'
  p_item jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_col text;
  v_id text;
  v_item jsonb;
  v_exists boolean;
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

  RETURN v_item;
END $$;

CREATE OR REPLACE FUNCTION tech_specs_item_delete(
  p_session_id uuid,
  p_kind text,
  p_item_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_col text;
  v_before int;
  v_after int;
BEGIN
  v_col := CASE p_kind WHEN 'integration' THEN 'integrations' WHEN 'rule' THEN 'rules' END;
  IF v_col IS NULL THEN
    RAISE EXCEPTION 'invalid kind: %, expected integration|rule', p_kind;
  END IF;

  EXECUTE format(
    'SELECT jsonb_array_length(COALESCE(%I, ''[]''::jsonb)) FROM "DesignSessionTechnicalSpecs" WHERE "sessionId" = $1',
    v_col
  ) INTO v_before USING p_session_id;

  IF v_before IS NULL THEN
    RETURN false;
  END IF;

  EXECUTE format($f$
    UPDATE "DesignSessionTechnicalSpecs"
    SET %I = COALESCE(
          (SELECT jsonb_agg(s) FROM jsonb_array_elements(%I) s WHERE s->>'id' <> $1),
          '[]'::jsonb
        ),
        "updatedAt" = now()
    WHERE "sessionId" = $2
  $f$, v_col, v_col) USING p_item_id, p_session_id;

  EXECUTE format(
    'SELECT jsonb_array_length(COALESCE(%I, ''[]''::jsonb)) FROM "DesignSessionTechnicalSpecs" WHERE "sessionId" = $1',
    v_col
  ) INTO v_after USING p_session_id;

  RETURN v_after < v_before;
END $$;

-- ============================================================
-- 5. Grants — service_role já tem acesso; usuários autenticados via execute
-- ============================================================

GRANT EXECUTE ON FUNCTION persona_journey_upsert(uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION persona_journey_delete(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION scope_item_upsert(uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION scope_item_delete(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION tech_specs_item_upsert(uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION tech_specs_item_delete(uuid, text, text) TO authenticated, service_role;

COMMIT;
