-- AgentUsage: token + cost accounting per agent run.
-- Row é gravada uma vez por chamada do streamText (no onFinish do engine).
-- Custos vêm do OpenRouter via providerMetadata.openrouter.usage.cost
-- (precisa habilitar `usage: { include: true }` no provider).

CREATE TABLE public."AgentUsage" (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "threadId"            TEXT REFERENCES public."ChatThread"(id) ON DELETE SET NULL,
  "agentName"           TEXT NOT NULL,
  "memberId"            TEXT REFERENCES public."Member"(id) ON DELETE SET NULL,
  "modelId"             TEXT NOT NULL,
  "promptTokens"        INT  NOT NULL DEFAULT 0,
  "completionTokens"    INT  NOT NULL DEFAULT 0,
  "totalTokens"         INT  NOT NULL DEFAULT 0,
  "cachedPromptTokens"  INT,
  "reasoningTokens"     INT,
  "costUsd"             NUMERIC(14, 8) NOT NULL DEFAULT 0,
  "generationId"        TEXT,
  "rawUsage"            JSONB,
  "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_usage_agent_created
  ON public."AgentUsage"("agentName", "createdAt" DESC);

CREATE INDEX idx_agent_usage_member_created
  ON public."AgentUsage"("memberId", "createdAt" DESC);

CREATE INDEX idx_agent_usage_thread
  ON public."AgentUsage"("threadId");

GRANT ALL ON public."AgentUsage" TO service_role, authenticated;
