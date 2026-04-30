-- Story Hierarchy V2 — Wave 1.6
-- Extensões da Task: vínculo opcional com UserStory + classificação de área +
-- doneAt sincronizado por trigger.

ALTER TABLE public."Task"
  ADD COLUMN IF NOT EXISTS "userStoryId" text REFERENCES public."UserStory"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "area"        text,
  ADD COLUMN IF NOT EXISTS "doneAt"      timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'task_area_valid'
  ) THEN
    ALTER TABLE public."Task"
      ADD CONSTRAINT "task_area_valid" CHECK (
        "area" IS NULL OR "area" IN ('front','back','infra','ops','mixed')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "task_user_story_idx" ON public."Task"("userStoryId") WHERE "userStoryId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "task_done_at_idx"    ON public."Task"("doneAt")      WHERE "doneAt"      IS NOT NULL;

-- Trigger: setar doneAt em transições para/de 'done', cobrindo INSERT e UPDATE
CREATE OR REPLACE FUNCTION public.sync_task_done_at()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'done' AND NEW."doneAt" IS NULL THEN
      NEW."doneAt" := now();
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
      NEW."doneAt" := now();
    ELSIF NEW.status IS DISTINCT FROM 'done' AND OLD.status = 'done' THEN
      NEW."doneAt" := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "task_done_at_trigger" ON public."Task";
CREATE TRIGGER "task_done_at_trigger"
BEFORE INSERT OR UPDATE ON public."Task"
FOR EACH ROW EXECUTE FUNCTION public.sync_task_done_at();
