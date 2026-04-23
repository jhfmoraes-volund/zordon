-- Agent table: configurable AI agents with name, prompt, model, capabilities
CREATE TABLE public."Agent" (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  description     TEXT,
  "systemPrompt"  TEXT NOT NULL DEFAULT '',
  "modelId"       TEXT NOT NULL DEFAULT 'anthropic/claude-sonnet-4.6',
  capabilities    JSONB NOT NULL DEFAULT '{}',
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_slug ON public."Agent"(slug);

-- Link ChatThread to an Agent
ALTER TABLE public."ChatThread" ADD COLUMN "agentId" TEXT REFERENCES public."Agent"(id);

-- Seed: Vitor - Design Session Agent
INSERT INTO public."Agent" (id, name, slug, description, "systemPrompt", capabilities)
VALUES (
  'agent-vitor',
  'Vitor',
  'design-session',
  'Especialista em design de produto. Conduz Design Sessions, analisa briefings, faz benchmark e preenche steps.',
  '',
  '{"maxSteps": 30, "writeTools": true, "readTools": true, "webSearch": true}'::jsonb
);
