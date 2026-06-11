-- Hash guard (runbook D11): composer calcula sha256 dos inputs por seção e
-- pula o LLM quando igual ao anterior — cron diário sem hash = pagar pra
-- reescrever o mesmo texto + churn de generatedAt.
ALTER TABLE "ProjectWikiSection" ADD COLUMN "inputsHash" text;
