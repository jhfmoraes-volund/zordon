-- Persist the full UIMessage `parts` array (text + tool calls + reasoning, etc.)
-- so chat history can be reconstructed with all visual chips after a reload or
-- thread switch. Existing rows fall back to a text-only part built from `content`.
ALTER TABLE public."ChatMessage"
  ADD COLUMN IF NOT EXISTS parts JSONB;
