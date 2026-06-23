-- Seed do cliente interno 'Volund'.
--
-- Decisão D3 (plano project-contract-allocation-ssot): projetos internos mantêm
-- Project.clientId required (sem mudar constraint) e apontam pra este cliente.
-- O kind selector "Interno" pré-seleciona Volund.
--
-- Idempotente: só insere se ainda não existir um Client name='Volund'.
--
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260624g_seed_volund_client.sql

BEGIN;

INSERT INTO public."Client" (id, name, "updatedAt")
SELECT gen_random_uuid(), 'Volund', now()
WHERE NOT EXISTS (SELECT 1 FROM public."Client" WHERE name = 'Volund');

COMMIT;
