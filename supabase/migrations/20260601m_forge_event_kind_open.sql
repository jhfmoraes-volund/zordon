-- ForgeEvent.kind: drop CHECK constraint pra aceitar todos os kinds emitidos pelo
-- worker (exec-prd, exec-story). Lista antiga (10 kinds) refletia spec inicial
-- e não cobria: manifest_bootstrapped, autorun_started, story_running, story_picked,
-- started, story_loaded, prompt_built, assistant_text, tool_use, claude_*,
-- raw_stdout, stderr, story_done, story_failed, autorun_done, ...
--
-- Tratamos kind como vocabulário aberto (worker decide). Validação semantica
-- fica no lado do leitor (UI agrupa por prefixo, ignora desconhecidos).

ALTER TABLE "ForgeEvent" DROP CONSTRAINT IF EXISTS "ForgeEvent_kind_check";
