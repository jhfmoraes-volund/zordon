-- Go-forward do PM no roster (Fase 2.1 #2). A backfill F2.7 só resolveu os PMs
-- órfãos de HOJE. Sem isso, um projeto NOVO (ou um pmId trocado) cujo PM não tem
-- labor_allocation nem ProjectAccess sumiria de finance.v_project_team — roster
-- vazio. Trigger concede ProjectAccess('lead') ao PM sempre que pmId é setado,
-- cobrindo TODOS os caminhos de escrita (sheet, /api/projects, agentes, scripts).
--
-- Consistente com o design da view (PM via ProjectAccess, não via perna mágica —
-- mesma decisão da F2.7). Acesso ≠ alocação (D8): NÃO cria labor_allocation, não
-- mexe no custo. Idempotente (ON CONFLICT DO NOTHING — não rebaixa acesso já
-- existente). Pula PM sem Member.userId. SECURITY DEFINER pra inserir em
-- ProjectAccess independente da RLS do caller.
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624p_pm_project_access_trigger.sql

CREATE OR REPLACE FUNCTION public.sync_pm_project_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF NEW."pmId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "userId" INTO v_user_id FROM "Member" WHERE id = NEW."pmId";
  IF v_user_id IS NULL THEN
    RETURN NEW; -- PM sem userId: não dá pra criar ProjectAccess
  END IF;

  INSERT INTO "ProjectAccess" ("userId", "projectId", role)
  VALUES (v_user_id, NEW.id, 'lead')
  ON CONFLICT ("userId", "projectId") DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_pm_project_access ON "Project";
CREATE TRIGGER trg_sync_pm_project_access
AFTER INSERT OR UPDATE OF "pmId" ON "Project"
FOR EACH ROW
EXECUTE FUNCTION public.sync_pm_project_access();
