-- Pilar 1+2: session continuity via Claude Agent SDK resume + auto-compact.
--
-- Daemon (scripts/daemon/exec-chat-turn.ts) deixa de ser stateless:
--   - 1ª turn do thread: query() fresh, captura sessionId, salva em ccSessionId
--   - 2ª+ turn: query({ resume: ccSessionId }) — Claude lembra nativo, prompt fica curto
--   - turnsSinceCompact incrementa por turn; threshold (50) dispara compact silencioso
--   - compact: query summary curta, salva em lastSummary, null em ccSessionId →
--     próxima turn começa session nova com summary como bootstrap
--
-- Coluna lastSummary fica viva mesmo após resets; prepare-turn injeta como
-- system context quando ccSessionId é null mas há summary.

ALTER TABLE "ChatThread"
  ADD COLUMN IF NOT EXISTS "ccSessionId" text,
  ADD COLUMN IF NOT EXISTS "turnsSinceCompact" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastSummary" text,
  ADD COLUMN IF NOT EXISTS "lastCompactAt" timestamptz;

COMMENT ON COLUMN "ChatThread"."ccSessionId" IS
  'Claude Agent SDK session id (UUID). Null = next turn starts fresh. Disk: ~/.claude/projects/<cwd-hash>/<id>.jsonl';
COMMENT ON COLUMN "ChatThread"."turnsSinceCompact" IS
  'Turns desde último compact (ou inicio). Threshold dispara compact silencioso.';
COMMENT ON COLUMN "ChatThread"."lastSummary" IS
  'Resumo da conversa após último compact (summary-only strategy: msgs antigas descartadas).';
COMMENT ON COLUMN "ChatThread"."lastCompactAt" IS
  'Timestamp do último compact. Null = nunca compactou.';
