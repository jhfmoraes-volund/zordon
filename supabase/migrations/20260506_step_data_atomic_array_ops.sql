-- Atomic array mutations on DesignSessionStepData.data
--
-- Replaces the previous read-modify-write pattern in lib/agent/context.ts that
-- caused races (UI debounced PUT vs. agent tool calls vs. concurrent agent
-- tools), producing duplicated and resurrected items in arrays like
-- data->'solutions'.
--
-- Design:
--   1. Each function takes (sessionId, stepKey, arrayKey, ...) and uses
--      pg_advisory_xact_lock(hashtext(sessionId || '|' || stepKey)) to
--      serialise concurrent mutations on the same step.
--   2. Mutations are a single UPDATE … SET data = jsonb_set(...) — no
--      intermediate JS state.
--   3. step_array_add is idempotent: if the item id already exists in the
--      array, it returns the existing item without appending.
--   4. step_array_update raises if the id is not found, so the caller never
--      silently writes to a phantom item.
--
-- The trigger at the bottom is a hard floor: any UPDATE that would leave
-- duplicate ids inside any array under data is rejected.

-- ── helpers ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.step_data_lock_key(p_session_id text, p_step_key text)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT hashtextextended(p_session_id || '|' || p_step_key, 0)
$$;

-- ── add ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.step_array_add(
  p_session_id uuid,
  p_step_key   text,
  p_array_key  text,
  p_item       jsonb,
  p_step_index int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing jsonb;
  v_id text := p_item->>'id';
BEGIN
  IF v_id IS NULL OR length(v_id) = 0 THEN
    RAISE EXCEPTION 'step_array_add: item.id is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(public.step_data_lock_key(p_session_id::text, p_step_key));

  -- Ensure the row exists (idempotent for first-time writes).
  INSERT INTO "DesignSessionStepData" (id, "sessionId", "stepKey", "stepIndex", data, "updatedAt")
  VALUES (gen_random_uuid(), p_session_id, p_step_key, p_step_index, jsonb_build_object(p_array_key, '[]'::jsonb), now())
  ON CONFLICT ("sessionId", "stepKey") DO NOTHING;

  -- Idempotency: if id already in the array, return the existing item.
  SELECT item INTO v_existing
  FROM "DesignSessionStepData" sd,
       jsonb_array_elements(COALESCE(sd.data->p_array_key, '[]'::jsonb)) item
  WHERE sd."sessionId" = p_session_id
    AND sd."stepKey" = p_step_key
    AND item->>'id' = v_id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  UPDATE "DesignSessionStepData"
  SET data = jsonb_set(
        COALESCE(data, '{}'::jsonb),
        ARRAY[p_array_key],
        COALESCE(data->p_array_key, '[]'::jsonb) || jsonb_build_array(p_item),
        true
      ),
      "updatedAt" = now()
  WHERE "sessionId" = p_session_id AND "stepKey" = p_step_key;

  RETURN p_item;
END
$$;

-- ── update ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.step_array_update(
  p_session_id uuid,
  p_step_key   text,
  p_array_key  text,
  p_item_id    text,
  p_updates    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_old   jsonb;
  v_new   jsonb;
  v_index int;
BEGIN
  PERFORM pg_advisory_xact_lock(public.step_data_lock_key(p_session_id::text, p_step_key));

  -- Locate the item with its index.
  SELECT item, (ord - 1)::int
    INTO v_old, v_index
  FROM "DesignSessionStepData" sd,
       jsonb_array_elements(COALESCE(sd.data->p_array_key, '[]'::jsonb))
       WITH ORDINALITY AS t(item, ord)
  WHERE sd."sessionId" = p_session_id
    AND sd."stepKey" = p_step_key
    AND item->>'id' = p_item_id
  LIMIT 1;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'step_array_update: item % not found in %.%',
      p_item_id, p_step_key, p_array_key
      USING ERRCODE = 'P0002';
  END IF;

  v_new := v_old || p_updates;
  -- Preserve the original id even if updates try to overwrite it.
  v_new := jsonb_set(v_new, ARRAY['id'], to_jsonb(p_item_id), true);

  UPDATE "DesignSessionStepData"
  SET data = jsonb_set(
        data,
        ARRAY[p_array_key, v_index::text],
        v_new,
        true
      ),
      "updatedAt" = now()
  WHERE "sessionId" = p_session_id AND "stepKey" = p_step_key;

  RETURN v_new;
END
$$;

-- ── delete ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.step_array_delete(
  p_session_id uuid,
  p_step_key   text,
  p_array_key  text,
  p_item_id    text
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_removed_any boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(public.step_data_lock_key(p_session_id::text, p_step_key));

  WITH filtered AS (
    SELECT
      sd."sessionId",
      sd."stepKey",
      jsonb_set(
        sd.data,
        ARRAY[p_array_key],
        COALESCE(
          (SELECT jsonb_agg(item ORDER BY ord)
             FROM jsonb_array_elements(COALESCE(sd.data->p_array_key, '[]'::jsonb))
                  WITH ORDINALITY AS t(item, ord)
            WHERE item->>'id' <> p_item_id),
          '[]'::jsonb
        ),
        true
      ) AS new_data,
      jsonb_array_length(COALESCE(sd.data->p_array_key, '[]'::jsonb)) AS old_len
    FROM "DesignSessionStepData" sd
    WHERE sd."sessionId" = p_session_id AND sd."stepKey" = p_step_key
  )
  UPDATE "DesignSessionStepData" sd
  SET data = filtered.new_data,
      "updatedAt" = now()
  FROM filtered
  WHERE sd."sessionId" = filtered."sessionId"
    AND sd."stepKey" = filtered."stepKey"
    AND filtered.old_len <> jsonb_array_length(filtered.new_data->p_array_key);

  GET DIAGNOSTICS v_removed_any = ROW_COUNT;
  RETURN v_removed_any;
END
$$;

-- ── safety net: reject any write that produces duplicate ids in arrays ─────

CREATE OR REPLACE FUNCTION public.step_data_reject_dup_ids()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_key text;
  v_arr jsonb;
  v_total int;
  v_distinct int;
BEGIN
  IF NEW.data IS NULL OR jsonb_typeof(NEW.data) <> 'object' THEN
    RETURN NEW;
  END IF;

  FOR v_key, v_arr IN SELECT * FROM jsonb_each(NEW.data) LOOP
    IF jsonb_typeof(v_arr) = 'array' THEN
      SELECT
        COUNT(*),
        COUNT(DISTINCT item->>'id')
      INTO v_total, v_distinct
      FROM jsonb_array_elements(v_arr) item
      WHERE item ? 'id';

      IF v_total > 0 AND v_total <> v_distinct THEN
        RAISE EXCEPTION
          'step_data_reject_dup_ids: duplicate ids in data->%, sessionId=%, stepKey=%',
          v_key, NEW."sessionId", NEW."stepKey"
          USING ERRCODE = '23505';
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS step_data_reject_dup_ids_trg ON "DesignSessionStepData";
CREATE TRIGGER step_data_reject_dup_ids_trg
BEFORE INSERT OR UPDATE ON "DesignSessionStepData"
FOR EACH ROW
EXECUTE FUNCTION public.step_data_reject_dup_ids();
