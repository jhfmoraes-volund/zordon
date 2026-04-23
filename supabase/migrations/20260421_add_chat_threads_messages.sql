-- Chat infrastructure for Design Session AI Agent
-- Threads represent conversations, Messages store the full history.
-- Designed for multi-channel: web (wizard chat), telegram, triggers.

CREATE TABLE public."ChatThread" (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sessionId" TEXT NOT NULL REFERENCES public."DesignSession"(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web', 'telegram', 'trigger')),
  title       TEXT,
  "createdBy" TEXT REFERENCES public."Member"(id),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public."ChatMessage" (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "threadId"    TEXT NOT NULL REFERENCES public."ChatThread"(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content       TEXT NOT NULL DEFAULT '',
  "toolCalls"   JSONB,
  "toolResults" JSONB,
  actions       JSONB,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_thread_session ON public."ChatThread"("sessionId");
CREATE INDEX idx_chat_msg_thread ON public."ChatMessage"("threadId", "createdAt");
