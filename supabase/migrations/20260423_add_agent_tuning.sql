-- Agent tuning: settings estruturados, playbooks (heurísticas) e versões taggeadas.
-- Permite que o PM ajuste o comportamento do Zordon (matriz FP, metas de sprint,
-- regras operacionais) sem tocar em código, e mede evolução via versões + feedback.

-- ─── 1. AgentConfig ─────────────────────────────────────────────────────────
-- Valores estruturados que código e prompt leem. Um par (agentId, key).
CREATE TABLE public."AgentConfig" (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "agentId"   TEXT NOT NULL REFERENCES public."Agent"(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       JSONB NOT NULL,
  description TEXT,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE("agentId", key)
);

CREATE INDEX idx_agent_config_agent ON public."AgentConfig"("agentId");

-- ─── 2. AgentHeuristic ──────────────────────────────────────────────────────
-- Playbooks / conhecimento carregável sob demanda. Só name+description entram
-- no prompt; body é carregado via tool load_heuristic(name).
CREATE TABLE public."AgentHeuristic" (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "agentId"   TEXT NOT NULL REFERENCES public."Agent"(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  body        TEXT NOT NULL,
  category    TEXT,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE("agentId", name)
);

CREATE INDEX idx_agent_heuristic_agent ON public."AgentHeuristic"("agentId", "isActive");

-- ─── 3. AgentVersion ────────────────────────────────────────────────────────
-- Snapshot manual taggeado. O PM decide quando congelar ("Publicar v2").
-- Congela prompt, modelo, config inteiro e heurísticas ativas.
CREATE TABLE public."AgentVersion" (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "agentId"      TEXT NOT NULL REFERENCES public."Agent"(id) ON DELETE CASCADE,
  tag            TEXT NOT NULL,
  notes          TEXT,
  "systemPrompt" TEXT NOT NULL,
  "modelId"      TEXT NOT NULL,
  config         JSONB NOT NULL,
  heuristics     JSONB NOT NULL,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdBy"    UUID REFERENCES auth.users(id),
  UNIQUE("agentId", tag)
);

CREATE INDEX idx_agent_version_agent ON public."AgentVersion"("agentId", "createdAt" DESC);

-- ─── 4. ChatThread.agentVersionId ───────────────────────────────────────────
-- Cada thread nasce vinculada à versão ativa do agente no momento.
-- Nullable: antes da 1ª versão publicada, threads ficam sem vínculo.
ALTER TABLE public."ChatThread"
  ADD COLUMN "agentVersionId" TEXT REFERENCES public."AgentVersion"(id);

-- ─── 5. ChatMessage.feedback ────────────────────────────────────────────────
-- Thumbs up/down no nível da mensagem. -1 / 0 / 1.
ALTER TABLE public."ChatMessage"
  ADD COLUMN feedback SMALLINT;

-- ─── 6. Seed: Agent row do Zordon ───────────────────────────────────────────
INSERT INTO public."Agent" (id, name, slug, description, "systemPrompt", capabilities)
VALUES (
  'agent-zordon',
  'Zordon',
  'ops',
  'Agente de operações. Gerencia sprints, aloca equipe, cria e ajusta tasks, monitora saúde da operação.',
  '',
  '{"maxSteps": 30, "writeTools": true, "readTools": true}'::jsonb
) ON CONFLICT (slug) DO NOTHING;

-- ─── 7. Seed: AgentConfig inicial do Zordon ─────────────────────────────────
-- Matriz de FP extraída de src/lib/function-points.ts (IFPUG-like).
INSERT INTO public."AgentConfig" ("agentId", key, value, description) VALUES
  ('agent-zordon', 'fp_matrix',
    '{"micro":{"trivial":3,"low":4,"medium":5,"high":7},"small":{"trivial":4,"low":5,"medium":7,"high":10},"medium":{"trivial":5,"low":7,"medium":10,"high":15},"large":{"trivial":7,"low":10,"medium":15,"high":21}}'::jsonb,
    'Matriz de Function Points por scope x complexity. Usada em suggestFunctionPoints() e apresentada no prompt.'),
  ('agent-zordon', 'ideal_fp_per_sprint', '80'::jsonb,
    'FP alvo por sprint. Zordon usa como referência ao propor composição de sprint.'),
  ('agent-zordon', 'sprint_length_days', '15'::jsonb,
    'Duração padrão de um sprint em dias.'),
  ('agent-zordon', 'fp_overflow_threshold', '1.1'::jsonb,
    'Fator que dispara alerta de sobrecarga. 1.1 = alerta se sprint > 110% da capacidade.'),
  ('agent-zordon', 'min_fp_per_member', '5'::jsonb,
    'FP mínimo esperado por membro ativo no sprint. Abaixo disso, Zordon sinaliza subutilização.'),
  ('agent-zordon', 'auto_assign_priority',
    '"urgency"'::jsonb,
    'Critério default ao sugerir atribuições: "urgency" | "capacity" | "skill_match".'),
  ('agent-zordon', 'require_approval_for',
    '["delete_task","bulk_move_tasks","split_task"]'::jsonb,
    'Ferramentas que exigem confirmação explícita do PM antes de executar.');

-- ─── 8. Seed: 5 heurísticas iniciais do Zordon ──────────────────────────────
INSERT INTO public."AgentHeuristic" ("agentId", name, title, description, body, category) VALUES
  ('agent-zordon', 'sprint-composicao',
    'Como compor um sprint saudável',
    'Carregue ao compor, revisar ou rebalancear um sprint — define FP alvo, mix de tipos e regras de qualidade.',
    '# Composição de sprint saudável

## FP alvo
- Alvo: o valor de `ideal_fp_per_sprint` em AgentConfig (default 80).
- Aceitável: 90–110% do alvo. Acima disso, dispare alerta.
- Abaixo de 70% do alvo: sprint subutilizado, proponha puxar mais do backlog.

## Mix de tipos
Um sprint saudável tem:
- Pelo menos 1 task de `feature` (progresso visível pro cliente).
- No máximo 30% de `refactor` + `setup` somados (evita sprint "técnico" sem valor).
- `bugfix` em qualquer proporção, mas com prioridade alta.

## Regras de ouro
1. Task sem atribuição é task que não vai sair. Sempre atribua antes de fechar planning.
2. Ninguém pode estar acima de 100% de capacidade sem você avisar explicitamente.
3. Task com `dueDate` antes do fim do sprint vira compromisso duro — sinalize risco se FP alto.
4. Se detectar 2+ tasks `large` pro mesmo membro, proponha redistribuir.',
    'planning'),

  ('agent-zordon', 'replanejamento-reuniao',
    'Como replanejar a partir de uma transcrição de reunião',
    'Carregue ao receber pedido tipo "organize o sprint com base na reunião X" ou ao analisar uma transcrição do Roam.',
    '# Replanejamento a partir de reunião

## Fluxo
1. Use `get_meeting_transcript` pra ler a reunião inteira.
2. Use `get_sprint_overview` + `list_sprints` + `get_backlog` pra mapear estado atual.
3. Extraia da transcrição, nesta ordem:
   - **Decisões diretas** ("vamos fazer X", "corta Y", "prioriza Z").
   - **Compromissos** ("eu pego X", "fulano faz Y até sexta").
   - **Sinalizações de risco** ("isso é mais complexo", "não dá pra essa sprint").
4. Traduza cada item extraído em ação concreta com tool correspondente.
5. Use `propose_plan` pra apresentar tudo em bloco antes de aplicar — nunca aplique em lote sem confirmação.

## Cuidados
- Se alguém discordou na reunião e não ficou claro quem venceu, **pergunte** — não decida pelo agente.
- Ação sem responsável nomeado: criar task mas deixar sem atribuição e sinalizar.
- Datas ambíguas ("próxima semana"): converta para data absoluta e peça confirmação.',
    'planning'),

  ('agent-zordon', 'redistribuicao-sobrecarga',
    'Como redistribuir quando alguém está sobrecarregado',
    'Carregue quando identificar ou for perguntado sobre membro com FP alocado > capacidade.',
    '# Redistribuição de sobrecarga

## Diagnóstico
Antes de mover nada, use `get_member_allocation` pra ter números atualizados. Sobrecarga = `fpAllocated > fpCapacity`.

## Ordem de preferência pra aliviar
1. **Postergar**: task com menor prioridade e sem `dueDate` apertado → `remove_task_from_sprint` (volta pro backlog).
2. **Redistribuir**: task de baixo contexto (setup, componente isolado) → mover para membro com capacidade restante via `assign_task`.
3. **Reestimar**: se a task foi mal estimada pra cima, corrigir `update_task_estimate`.
4. **Quebrar**: task `large` que pode virar 2 `medium` → `split_task`.

## Nunca faça
- Mover task `in_progress` ou `review` entre membros sem autorização explícita — contexto já investido se perde.
- Tirar task com `dueDate` próximo sem avisar o PM.
- Redistribuir sem conferir `skill_match` se a task for técnica especializada.',
    'capacity'),

  ('agent-zordon', 'criacao-tasks-qualidade',
    'Checklist pra criar tasks bem formadas',
    'Carregue ao criar tasks em lote ou ao revisar qualidade do backlog.',
    '# Task bem formada — checklist

## Título
- Verbo no imperativo + objeto concreto. Ex: "Implementar login magic link".
- ❌ "Auth" / "Login" / "Tela de usuário" (vagos demais).

## Descrição
Deve responder em 2–4 linhas:
1. **O quê**: entregável concreto.
2. **Por quê**: motivação / user story curta.
3. **Critério de aceite**: como saber que está pronto.

## Estimativa (scope × complexity)
- `micro` (1-2h): ajuste pontual, texto, config.
- `small` (meio dia): componente isolado, endpoint simples.
- `medium` (1-2 dias): feature com camadas (UI + API + DB).
- `large` (3+ dias): fluxo end-to-end complexo → **considere split antes de criar**.

- `trivial/low/medium/high` reflete desconhecido técnico, não tamanho.
- Se o projeto é novo e o membro nunca tocou nessa stack, suba 1 nível de complexity.

## Tipo
- `feature`: novo fluxo/recurso pro cliente.
- `component`: peça reusável (botão, modal, hook).
- `bugfix`: algo quebrado que já existia.
- `refactor`: reorg sem mudar comportamento.
- `setup`: infra, CI, config de ambiente.
- `management`: documentação, reunião-task, alinhamento.
- `seed`: popular dados.',
    'quality'),

  ('agent-zordon', 'quando-pedir-confirmacao',
    'Quando executar direto vs quando pedir confirmação antes',
    'Carregue quando estiver em dúvida se deve agir ou confirmar — define a linha entre proatividade e segurança.',
    '# Confirmar antes OU executar direto?

## Execute DIRETO (sem perguntar)
- Leituras (get_*, list_*, ask_*).
- Atualizações pequenas e reversíveis: mudar prioridade, atualizar status pra próximo válido, renomear título.
- Criar tasks a partir de pedido claro com todos os campos informados.

## PERGUNTE ANTES
- Qualquer ferramenta listada em `require_approval_for` (AgentConfig).
- Deletar ou reescrever descrição de task existente.
- Mover em lote (> 3 tasks numa chamada).
- Reestimativas que mudam FP em mais de 50%.
- Atribuir task que deixa o membro acima da capacidade.
- Qualquer ação que dependa de inferência ambígua ("acho que ele quis dizer X").

## Forma de perguntar
Apresente um plano estruturado curto:
> Vou fazer:
> - [ação 1]
> - [ação 2]
> Confirma?

Nunca pergunte "posso fazer X?" sem listar os itens — vira fricção.',
    'policy');

-- ─── 9. Grants (default privileges já cobrem, mas explicito pra garantir) ───
GRANT ALL ON public."AgentConfig"    TO service_role, authenticated;
GRANT ALL ON public."AgentHeuristic" TO service_role, authenticated;
GRANT ALL ON public."AgentVersion"   TO service_role, authenticated;
