-- Fix: tabela Agent foi criada antes da migration de default privileges,
-- então não herdou o grant pra service_role. API rotas que usam db()
-- (service_role) batiam em 42501 "permission denied for table Agent".

GRANT ALL ON public."Agent" TO service_role;
