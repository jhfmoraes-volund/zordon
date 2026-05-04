# Sprint Lifecycle — Manual com 3 Estados

**Status:** proposto
**Data:** 2026-05-04
**Autor:** João + Claude
**Tag de commit:** `ZRD-JM-37` (ou próximo livre)

---

## Contexto

Hoje sprint tem campo `status TEXT NOT NULL DEFAULT 'planning'` com 3 valores em uso (`planning` / `active` / `completed`), todos manuais via dropdown no `sprint-dialog.tsx`. Não existe automação, trigger, cron ou validação de transição. O DB aceita N sprints `active` no mesmo projeto e a UI faz `find(s => s.status === 'active')` cegamente — pega a primeira.

**Estado real (2026-05-04):** 20 sprints `planning` + 1 `active` no banco.

## Decisão

Manter ciclo manual, mas trocar o vocabulário pra alinhar com mercado (Linear / Jira) e fechar o gap de "DB não sabe qual é a verdade":

- 3 estados claros: `upcoming` / `active` / `completed`
- UNIQUE parcial garantindo **uma sprint ativa por projeto**
- Botão dedicado pra promover `upcoming → active` (ativa próxima + completa anterior na mesma transação)
- Sem cron/trigger/auto-ativação. Automação fica pra depois.

## Modelo

### Estados

| Valor | Significado | Transições saindo |
|---|---|---|
| `upcoming` | Planejada, ainda não promovida | → `active` (via botão "Ativar") |
| `active` | Sprint corrente do projeto | → `completed` (via "Concluir" OU auto quando outra `upcoming` é ativada) |
| `completed` | Encerrada, histórico | terminal |

### Regras de integridade no DB

```sql
-- CHECK: só os 3 valores válidos
ALTER TABLE "Sprint"
  ADD CONSTRAINT sprint_status_valid
  CHECK (status IN ('upcoming', 'active', 'completed'));

-- UNIQUE parcial: no máximo uma active por projeto
CREATE UNIQUE INDEX sprint_one_active_per_project
  ON "Sprint" ("projectId")
  WHERE status = 'active';

-- Default novo
ALTER TABLE "Sprint" ALTER COLUMN status SET DEFAULT 'upcoming';
```

### Transição transacional (ativar próxima)

Endpoint `POST /api/sprints/[id]/activate`:

```sql
BEGIN;
  UPDATE "Sprint" SET status = 'completed'
   WHERE "projectId" = $1 AND status = 'active';
  UPDATE "Sprint" SET status = 'active'
   WHERE id = $2 AND "projectId" = $1 AND status = 'upcoming';
COMMIT;
```

A UNIQUE parcial garante que se algo der errado entre os dois UPDATEs, a transação aborta antes de violar o invariante.

## UI

Mantém o que já existe (header, badges, lista de sprints). Mudanças cirúrgicas:

1. **`sprint-dialog.tsx`** — dropdown de status passa a oferecer `upcoming` / `active` / `completed`. Em criação, default = `upcoming`.
2. **Botão "Ativar sprint"** — novo, aparece em sprints `upcoming` na lista do projeto. Chama `POST /api/sprints/[id]/activate`. Em sprints `active` aparece "Concluir sprint" (chama `PUT /api/sprints/[id]` com `status='completed'`).
3. **Filtros** — `GET /api/sprints?status=active,planning` vira `?status=active,upcoming`. Mesma intenção (sprints "em andamento ou por vir"), nome novo.

### Modais de confirmação

Confirmação só aparece quando há consequência não-óbvia. Botões primários nomeiam a ação concreta ("Ativar" / "Concluir"), não "Confirmar".

| Ação | Modal? | Conteúdo |
|---|---|---|
| Ativar `upcoming` **sem** `active` no projeto | Não | Ação direta |
| Ativar `upcoming` **com** `active` no projeto | **Sim** | "Ativar Sprint N? A Sprint M (atualmente ativa) será marcada como concluída." + datas + contagem de tarefas concluídas da sprint anterior |
| Concluir `active` manualmente | **Sim** | "Concluir Sprint N? O projeto ficará sem sprint ativa até você ativar a próxima." |
| Editar nome/datas da sprint | Não | Form padrão |

Sem opção "não me pergunte de novo" — frequência é baixa (1x por semana por projeto) e a consequência justifica o aviso.

Não mexer:
- Header do projeto (já mostra a `active`, continua igual)
- Lógica `find(s => s.status === 'active')` nos 7 pontos atuais — continua funcionando, agora com garantia de unicidade do DB
- `findCurrentSprint()` em `components/sprint/helpers.ts` — fallback chain segue útil

## Migração de dados

Hoje:
- 20 `planning` → `upcoming` (rename, mesma semântica)
- 1 `active` → mantém
- 0 `completed` → valor passa a ser válido pra novas

Ordem das operações na migração SQL:

1. Rename `planning` → `upcoming`
2. ALTER DEFAULT pra `upcoming`
3. ADD CHECK constraint
4. CREATE UNIQUE INDEX parcial
5. (não dropar índices existentes — `Sprint_status_idx` e `Sprint_projectId_status_idx` continuam úteis)

## Plano de execução

### Fase 1 — DB

- [ ] Criar `supabase/migrations/20260504_sprint_lifecycle_3_states.sql`
- [ ] Rodar via `psql "$DIRECT_URL" -f ...` (regra do projeto)
- [ ] Validar: `SELECT status, COUNT(*) FROM "Sprint" GROUP BY status` → esperado 20 upcoming + 1 active
- [ ] Regenerar `src/lib/supabase/database.types.ts`

### Fase 2 — Backend

- [ ] `POST /api/sprints/[id]/activate` — endpoint novo, transação ativa+completa
- [ ] `PUT /api/sprints/[id]` — adicionar validação: rejeitar `status='active'` direto (forçar uso do endpoint /activate)
- [ ] `GET /api/sprints` — trocar default `["active","planning"]` por `["active","upcoming"]`
- [ ] `src/app/api/projects/[id]/route.ts:102` — sem mudança, `find(s => s.status === 'active')` continua certo
- [ ] `src/app/(dashboard)/page.tsx:82` — sem mudança
- [ ] `src/components/meetings/meeting-sheet.tsx:116` — sem mudança

### Fase 3 — UI

- [ ] `src/components/sprint-dialog.tsx:214-220` — atualizar `<SelectItem>` values: `upcoming` / `active` / `completed`
- [ ] `src/app/(dashboard)/projects/[id]/page.tsx` — adicionar botão "Ativar sprint" em items `upcoming` e "Concluir sprint" em items `active` na lista de sprints
- [ ] `src/components/sprint/helpers.ts:8-35` — atualizar fallback chain pra usar `upcoming` em vez de derivar via datas (está praticamente certo, só renomear referências internas se houver)

### Fase 4 — Agente

- [ ] `src/lib/agent/agents/alpha/tools.ts:499` — atualizar enum: `z.enum(["upcoming", "active", "completed"]).default("upcoming")`
- [ ] Atualizar prompt do agente se mencionar "planning"

### Fase 5 — Validação manual

- [ ] Criar sprint nova via UI → confirma default `upcoming`
- [ ] Promover `upcoming → active` → confirma que a anterior virou `completed` automaticamente
- [ ] Tentar criar duas `active` no mesmo projeto via API direto → DB rejeita (UNIQUE viola)
- [ ] Concluir sprint `active` → fica sem ativa no projeto até PM ativar a próxima (comportamento esperado)
- [ ] Filtros do dashboard mostram sprints corretas em "em andamento"

## Não-objetivos (deixar pra depois)

- Auto-ativação na segunda-feira (cron / pg_cron) — adicionar quando o time pedir; o endpoint `/activate` já é o ponto de extensão pronto
- `closedAt` timestamp explícito — só se virar requisito de relatório
- Reabrir sprint `completed` — caso raro, adiciona se aparecer
- Múltiplas sprints ativas em paralelo (squads diferentes no mesmo projeto) — fora de escopo

## Riscos

| Risco | Mitigação |
|---|---|
| Sprint `active` órfã se PM nunca ativar a próxima | Aceitável — o projeto fica "sem sprint ativa" e a UI já lida (helper `findCurrentSprint` tem fallback) |
| Endpoint `/activate` rodar em paralelo (race) | UNIQUE parcial protege; segunda chamada falha com erro claro |
| Sprint `active` migrada que está fora do range de datas | Não importa — modelo é manual, datas são informativas |
| Agentes/scripts antigos gravando `status='planning'` | CHECK constraint rejeita — fail loud é melhor que silencioso |

## Critério de pronto

- Migração rodada em produção, contagens conferem
- Zero ocorrências de `status === 'planning'` no código
- Botão "Ativar sprint" funciona e completa a anterior
- DB rejeita duas `active` simultâneas no mesmo projeto
- Alpha agent cria sprint com default `upcoming`
