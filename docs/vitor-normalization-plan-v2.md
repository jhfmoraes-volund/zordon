# Vitor — Normalização, Tools por Entidade, Realtime (v2)

**Status:** Planning (2026-05-12)
**Branch:** `joao-dev`
**Substitui:** [vitor-normalization-plan.md](vitor-normalization-plan.md) (v1).
**Janela:** todas as DS com Vitor estão bloqueadas → podemos quebrar wire-format, mudar shapes, dropar tabelas sem feature flag.
**Pré-requisito técnico:** Fases 0–2.6 da DS normalization concluídas (`bee5642` + `6a4ba28`).

## O que mudou da v1

| v1 | v2 |
|---|---|
| 16 read tools + 25 write tools (~41 total) | **9 tools por entidade** (1 read + 1 write por entidade, write é discriminated union) + 2 utilitárias |
| 5 fases (V1→V5) | **3 PRs** sequenciais — tools + prompt num só, writes + cutover noutro, drop noutro |
| A/B flag opcional | **Sem flag.** Janela aberta, troca atômica |
| "Read fino" como princípio | **Read fino + write atômico + emit realtime** como princípio único |
| Realtime: não mencionado | **Postgres realtime nas 9 tabelas** — UI vê Vitor escrevendo ao vivo, Vitor vê UI editando entre turnos |
| Métrica alvo sem baseline | **Baseline obrigatório antes de V1** (30min de instrumentação) |
| Drop no mesmo dia do cutover | **Drop 24h depois** — janela pequena pra pegar rota fria |

---

## 1. Princípio único

> **Cada entidade tem 1 tabela, 1 read tool, 1 write tool, 1 canal realtime. Vitor e UI são pares iguais nesse triângulo.**

Tudo o resto cai disso:
- Read tool puxa direto da tabela com filtros (sem `get_step_data`).
- Write tool faz `INSERT`/`UPDATE`/`DELETE` por id (sem read-modify-write).
- Postgres dispara `postgres_changes` → UI hidrata sem polling, Vitor relê na próxima turn sem cache stale.
- 1 sistema mental: "a tabela é o estado". Não tem JSON paralelo, não tem `DesignSessionStepData.data` espelhado.

`DesignSessionStepData` morre. `getStepData`, `getStepDataForPrompt`, `updateStepData`, `step_array_*` RPCs — todos morrem.

---

## 2. Inventário de tools — 9 entidades, 2 tools cada

### 2.1 Entidades (corresponde 1:1 a uma tabela)

| Entidade | Tabela | Forma |
|---|---|---|
| `product_vision` | `DesignSessionProductVision` | 1 row (escalares) |
| `scope` | `DesignSessionScope` | 1 row com 4 jsonb arrays (`inScope`, `outOfScope`, `does`, `doesNot`) |
| `persona` | `DesignSessionPersona` | N rows, journey como jsonb (`asIsSteps`/`toBeSteps`) |
| `brainstorm` | `DesignSessionBrainstormFeature` | N rows |
| `priority` | `DesignSessionPriorityItem` | N rows com `bucket: mvp\|next\|out` |
| `risk` | `DesignSessionRisk` | N rows |
| `gap` | `DesignSessionGap` | N rows |
| `tech_specs` | `DesignSessionTechnicalSpecs` | 1 row + 2 jsonb arrays (`integrations`, `rules`) |
| `hypothesis` | `DesignSessionHypothesis` | N rows |

### 2.2 Tool por entidade — read + write

Cada entidade ganha **2 tools** (em vez de 4-6 da v1):

```ts
// Read — filtros estreitos, default seco
read_persona({
  ids?: string[],
  includeJourney?: boolean,   // default false
  fields?: ('name'|'role'|'context'|'asIsSteps'|'toBeSteps')[],
})

// Write — discriminated union sobre action
write_persona({
  action: 'create' | 'update' | 'delete',
  // create: name+role+context required, returns id
  // update: id required, partial fields
  // delete: id only
  id?, name?, role?, context?,
  asIsSteps?, toBeSteps?,  // só pra create/update
})
```

**Por que discriminated union em vez de 3 tools separadas:**
- O modelo já entende `{ action: 'create' }` perfeitamente (mesmo padrão que ele usa em REST).
- Tool description ocupa lugar no contexto **uma vez**, com os 3 modos em paralelo.
- Reduz catálogo de 41→20 sem perder clareza semântica.
- Mais perto do REST que o time já mantém — write tool vira casca fina sobre o handler já existente.

### 2.3 Tabela completa de tools

| Tool | Action options | Tabela |
|---|---|---|
| `read_product_vision` / `write_product_vision` | update (1 row, upsert por sessionId) | ProductVision |
| `read_scope` / `write_scope_item` | create, update, delete por `{bucket, id}` | Scope (jsonb interno — RPC helper) |
| `read_persona` / `write_persona` | create, update, delete | Persona |
| `read_brainstorm` / `write_brainstorm` | create, update, archive, delete | BrainstormFeature |
| `read_priority` / `write_priority` | create, update, move (atalho pra mudar bucket), delete | PriorityItem |
| `read_risk` / `write_risk` | create, update, delete | Risk |
| `read_gap` / `write_gap` | create, update, delete | Gap |
| `read_tech_specs` / `write_tech_specs` | update escalares + `add_integration\|delete_integration\|add_rule\|delete_rule` | TechnicalSpecs |
| `read_hypothesis` / `write_hypothesis` | create, update, delete | Hypothesis |
| `read_files` / `read_file_text({ fileId, range? })` | (sem write — upload é UI) | DesignSessionFile |
| `mvp_check` / `search_doc` | (auxiliares — usam tabelas direto) | — |

**Total:** 9 read entity-tools + 9 write entity-tools + 2 file-tools + 2 auxiliares = **22 tools** (vs 41 da v1, vs 5 hoje).

### 2.4 Por que não "1 tool universal `dsmutate`"

Tentação: `dsmutate({ entity: 'persona', action: 'create', data: {...} })`. Recusada porque:
- O Zod schema vira `z.discriminatedUnion('entity', ...)` aninhado com `z.discriminatedUnion('action', ...)` — gigante, e o tool description vira ilegível.
- Modelo perde a affordance "qual tool existe pra que entidade". A diferença entre `write_persona` e `write_brainstorm` é o tipo da affordance — colocá-las no mesmo nome empilha decisões.
- Tool result fica heterogêneo (`{ persona: ... }` vs `{ brainstorm: ... }`), modelo precisa fazer narrow toda vez.

A linha que importa: **separar por entidade (não por step, não por ação).** Action vira parâmetro porque é eixo curto (3-4 valores); entidade vira tool porque é eixo longo (9 valores) com semântica distinta.

### 2.5 Default seco — todos os reads

Cada read tool segue a mesma forma de default:

```
read_X({}) → projection mínima (id + título/nome)
read_X({ ids: [...] }) → mesma projection, filtrada
read_X({ ids: [...], fields: ['howItSolves', 'targetPersona'] }) → fields explícitos
read_X({ id: 'bs#42' }) → row completa (singular)
```

Regra: **sem filtros = projection seca**. Modelo opta-in nos campos pesados.

---

## 3. Realtime — Postgres changes nas 9 tabelas

### 3.1 Por que vale

Hoje:
- Vitor escreve no JSON, UI lê das tabelas → divergência (§1.1 v1).
- UI escreve nas tabelas, Vitor lê JSON → outra divergência.
- UI atualiza tela só quando o usuário salva manualmente, ou hard refresh.

Com realtime:
- UI subscribe nas 9 tabelas filtradas por `sessionId`. Vitor escreve → tela atualiza em ~200ms.
- Vitor relê tabela a cada turn (`buildSessionContext` já faz isso). Usuário edita → próximo turn do Vitor vê. **Não é "live" no meio de uma resposta, é "fresh por turn" — bom o suficiente, escopo claro.**

### 3.2 Migration de habilitação

```sql
-- 20260516_design_session_realtime.sql
ALTER TABLE "DesignSessionProductVision" REPLICA IDENTITY FULL;
ALTER TABLE "DesignSessionScope" REPLICA IDENTITY FULL;
ALTER TABLE "DesignSessionPersona" REPLICA IDENTITY FULL;
ALTER TABLE "DesignSessionBrainstormFeature" REPLICA IDENTITY FULL;
ALTER TABLE "DesignSessionPriorityItem" REPLICA IDENTITY FULL;
ALTER TABLE "DesignSessionRisk" REPLICA IDENTITY FULL;
ALTER TABLE "DesignSessionGap" REPLICA IDENTITY FULL;
ALTER TABLE "DesignSessionTechnicalSpecs" REPLICA IDENTITY FULL;
ALTER TABLE "DesignSessionHypothesis" REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime
    ADD TABLE "DesignSessionProductVision",
              "DesignSessionScope",
              "DesignSessionPersona",
              "DesignSessionBrainstormFeature",
              "DesignSessionPriorityItem",
              "DesignSessionRisk",
              "DesignSessionGap",
              "DesignSessionTechnicalSpecs",
              "DesignSessionHypothesis";
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
```

**Padrão já usado** em `20260507_telegram_integration.sql:34-43` e `20260506_notifications.sql:78-89`. Não inventa nada.

### 3.3 Hook genérico no front

```ts
// src/hooks/use-design-session-realtime.ts
export function useDesignSessionRealtime(
  sessionId: string,
  onChange: (entity: DSEntity, event: 'INSERT'|'UPDATE'|'DELETE', row: Record<string,unknown>) => void,
) {
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`ds:${sessionId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'DesignSessionPersona', filter: `sessionId=eq.${sessionId}` },
        (p) => onChange('persona', p.eventType, p.new ?? p.old))
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'DesignSessionBrainstormFeature', filter: `sessionId=eq.${sessionId}` },
        (p) => onChange('brainstorm', p.eventType, p.new ?? p.old))
      // ... 7 mais
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [sessionId, onChange]);
}
```

Cada board (`persona-journey-board.tsx`, `solution-card-board.tsx`, etc.) consome esse hook e pluga no seu `useOptimisticCollection` via `external_update`:

```ts
const optimistic = useOptimisticCollection<Persona, never>(initial);
useDesignSessionRealtime(sessionId, (entity, event, row) => {
  if (entity !== 'persona') return;
  if (event === 'INSERT' || event === 'UPDATE') {
    optimistic.dispatch({ type: 'external_update', items: [row as Persona] });
  } else if (event === 'DELETE') {
    optimistic.dispatch({ type: 'external_update', items: [], removedIds: [row.id] });
  }
});
```

A memory `feedback_optimistic_reconcile_create.md` cobre o caso "create otimista + create real" — `external_update` ignora se já tem o id, ou substitui temp por real. Não inventamos.

### 3.4 Limites do realtime — declarados

- **Não é colaborativo CRDT.** Dois editando o mesmo campo → last-write-wins (já é o estado atual da `useOptimisticCollection`).
- **Não bypassa RLS.** Realtime respeita as policies das 9 tabelas — usuário sem acesso à sessão não recebe eventos.
- **Vitor não escuta realtime durante geração.** Ele relê na próxima turn. Se o usuário editar no meio de uma resposta longa, o Vitor terminou com snapshot antigo. Aceitável.
- **Tabelas privadas (`DesignSessionStepData`, `DesignSessionFile`, transcripts) ficam fora.** Só as 9 entidades editáveis pelo board.

---

## 4. Mudanças no prompt

### 4.1 Substituir as ~10 menções a `get_step_data` por tools específicas

| Antes | Depois |
|---|---|
| `get_step_data("personas_journeys") pra obter nomes` | `read_persona({})` (default seco: name+role) |
| `get_step_data("brainstorm") pra pegar bs#ids` | `read_brainstorm({})` (default: id+title) |
| `get_step_data("prioritization") pra confirmar bucket` | `read_priority({ buckets: ['mvp'] })` |
| `get_step_data("pre_work") pra o doc inteiro` | `read_files({})` + `read_file_text({ fileId, range })` |
| `get_step_data("personas_journeys") pra journey` | `read_persona({ ids: [pId], includeJourney: true })` |

### 4.2 Bloco "TOKEN HYGIENE" no prompt

```
TOKEN HYGIENE — leia o mínimo
- Toda read tool aceita filtros (ids, fields, buckets). USE.
- Default é projection seca (id + título). Peça fields explicitamente se precisar.
- Se o dado já aparece em sessionContext (system prompt), NÃO chame read_*.
- Pra editar 1 item: read_X({ id }) → write_X({ action:'update', id, ...patch }). Nunca read_X({}).
- Pra listar pro usuário: read_X({}) basta — ele vai pedir mais se quiser.
```

### 4.3 Remover `currentStepData` do system prompt

[vitor/index.ts:82,185](src/lib/agent/agents/vitor/index.ts#L82) injeta JSON do step atual a cada turn. **Removido inteiro.** Briefing precisa de `subPhase`/`targetStoryId` → vêm das colunas `DesignSession.briefing*` (Fase 2.6) como 2 strings:

```ts
buildPrompt({
  // ...
  briefingSubPhase: agentContext.briefingSubPhase as string | null,
  briefingTargetStoryId: agentContext.briefingTargetStoryId as string | null,
});
```

Sem JSON, sem `getStepDataForPrompt`, sem `_draft` strip.

---

## 5. Schema — 1 migration só

```sql
-- 20260516_design_session_realtime_and_journey_rpc.sql
-- 1. Realtime publication (§3.2)
ALTER TABLE ... REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE ...;

-- 2. RPC pra journey step (mantém asIsSteps/toBeSteps como jsonb)
CREATE OR REPLACE FUNCTION persona_journey_upsert(
  p_persona_id uuid,
  p_kind text,           -- 'asIs' | 'toBe'
  p_step jsonb           -- { id?, description, painOrGain }
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_col text;
  v_id text;
  v_result jsonb;
BEGIN
  v_col := CASE p_kind WHEN 'asIs' THEN 'asIsSteps' WHEN 'toBe' THEN 'toBeSteps' END;
  IF v_col IS NULL THEN RAISE EXCEPTION 'invalid kind: %', p_kind; END IF;
  v_id := COALESCE(p_step->>'id', gen_random_uuid()::text);
  -- upsert: replace if id exists, append if not
  EXECUTE format($f$
    UPDATE "DesignSessionPersona"
    SET %I = COALESCE(
      (SELECT jsonb_agg(CASE WHEN s->>'id' = $2 THEN $3 ELSE s END)
       FROM jsonb_array_elements(COALESCE(%I, '[]'::jsonb)) s
       WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(%I, '[]'::jsonb)) ss WHERE ss->>'id' = $2)),
      COALESCE(%I, '[]'::jsonb) || $3
    )
    WHERE id = $1
    RETURNING %I
  $f$, v_col, v_col, v_col, v_col, v_col) USING p_persona_id, v_id, jsonb_set(p_step, '{id}', to_jsonb(v_id))
  INTO v_result;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION persona_journey_delete(
  p_persona_id uuid,
  p_kind text,
  p_step_id text
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_col text; BEGIN
  v_col := CASE p_kind WHEN 'asIs' THEN 'asIsSteps' WHEN 'toBe' THEN 'toBeSteps' END;
  IF v_col IS NULL THEN RAISE EXCEPTION 'invalid kind: %', p_kind; END IF;
  EXECUTE format($f$
    UPDATE "DesignSessionPersona"
    SET %I = (SELECT jsonb_agg(s) FROM jsonb_array_elements(%I) s WHERE s->>'id' <> $2)
    WHERE id = $1
  $f$, v_col, v_col) USING p_persona_id, p_step_id;
  RETURN FOUND;
END $$;

-- 3. RPC pra scope item (mesmo princípio nos 4 buckets jsonb)
CREATE OR REPLACE FUNCTION scope_item_upsert(
  p_session_id uuid, p_bucket text, p_item jsonb
) RETURNS jsonb LANGUAGE plpgsql AS $$
-- bucket in ('inScope','outOfScope','does','doesNot')
-- mesma forma: jsonb_set / append
... ;
```

**RPCs em vez de tabelas novas porque:** journey e scope são "filhos baratos" das suas parents. Tabela extra = mais joins, mais RLS, mais types. RPC tipada = 1 função, 1 chamada, granular o suficiente pro write tool.

Nenhuma outra migration. As 9 tabelas e colunas briefing já existem.

---

## 6. Ordem de execução — 3 PRs

### Fase 0 — Baseline (antes de qualquer código, ~30min)

Instrumentar `webConnector.handle` com:
```ts
console.log('[vitor-tokens]', {
  sessionId,
  stepKey: currentStepKey,
  systemPromptTokens: estimate(stable + volatile),
  currentStepDataTokens: estimate(currentStepData),
  sessionContextTokens: estimate(sessionContext),
});
```

Rodar 10 turns na DS Zelar v2 (briefing + 1-2 outros steps). Anotar baseline real.

**Decisão gate:** se `currentStepDataTokens + redundância < 5k`, **abortar v2**. O ganho não compensa.

### PR 1 — Reads + prompt + realtime infra (estimativa: 5h)

Branch: `joao-dev` (direto — todos consumidores estão bloqueados).

**Commits:**
1. `ZRD-JM-NN: ds — migration realtime publication + journey/scope RPCs` (§5)
2. `ZRD-JM-NN: ds — 11 read tools (read_X por entidade + read_files + read_file_text)` (§2.3)
3. `ZRD-JM-NN: ds — hook useDesignSessionRealtime + integração nos 9 boards` (§3.3)
4. `ZRD-JM-NN: ds — refazer prompt.ts (remove get_step_data, adiciona TOKEN HYGIENE, briefing como 2 strings)` (§4)
5. `ZRD-JM-NN: ds — remover currentStepData + getStepDataForPrompt do loadContext` (§4.3)

**Ainda vivos depois deste PR:**
- `get_step_data` (read genérica) — Vitor não usa mais, mas tool ainda registrada (smoke).
- `set_field`/`add_item`/`update_item`/`delete_item` — Vitor ainda usa pra escrever.
- `DesignSessionStepData` — tabela ainda existe.

**Validação:**
- `npm run db:types && tsc --noEmit && npm run build` passa.
- Abre Zelar v2 em 2 tabs → cria persona numa, vê aparecer na outra em <500ms.
- Manda mensagem pro Vitor → vê tokens no log do baseline caindo 30%+.

### PR 2 — Writes + cutover (estimativa: 6h)

**Commits:**
1. `ZRD-JM-NN: ds — 9 write tools por entidade (write_X discriminated union)` (§2.2-2.3)
2. `ZRD-JM-NN: ds — atualizar prompt.ts com write_X tools no manual` (§4.1 estendido pra writes)
3. `ZRD-JM-NN: ds — remover 5 tools genéricas de tools.ts (get_step_data + 4 writes)` (§2.4)
4. `ZRD-JM-NN: ds — limpar webConnector firstMessageAt JSON stamp → coluna DesignSession.briefingFirstMessageAt`

**Pre-flight script:**
```bash
rg "get_step_data|set_field|add_item|update_item|delete_item|getStepData|updateStepData|getStepDataForPrompt|step_array_" \
  src/ supabase/ scripts/ \
  --type ts --type sql
```
Tem que voltar **só** referências em comentários, `scripts/zelar-*-drafts.ts` (one-off históricos), e `supabase/functions/export-design-session/index.ts`.

**Para export edge function:** migrar pra leitura das 9 tabelas + briefing cols. Sem isso, export quebra silenciosamente.

**Validação:**
- 1 conversa completa em cada step (product_vision, personas, brainstorm, prioritization, briefing) — Vitor cria/edita/deleta sem usar tools antigas.
- Realtime: UI vê escrita do Vitor em <500ms em cada step.
- `tsc && build` passa.

### PR 3 — Drop legacy (estimativa: 1h, **24h após PR 2 em produção**)

**Por que esperar 24h:** rota fria. Edge function, cron, replay de mensagens antigas que carregam histórico — qualquer uma pode ainda referenciar `DesignSessionStepData`. 24h dá pra pegar.

**Commits:**
1. `ZRD-JM-NN: ds — drop DesignSessionStepData + step_array_* RPCs + endpoint genérico`

```sql
-- 20260517_drop_design_session_step_data.sql
DROP TABLE "DesignSessionStepData" CASCADE;
DROP FUNCTION IF EXISTS step_array_add(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS step_array_update(uuid, text, text, text, jsonb);
DROP FUNCTION IF EXISTS step_array_delete(uuid, text, text, text);
DROP FUNCTION IF EXISTS sync_brainstorm_features() CASCADE;
DROP FUNCTION IF EXISTS sync_brainstorm_buckets() CASCADE;
DROP FUNCTION IF EXISTS step_data_reject_dup_ids() CASCADE;
-- Confirmar: ALTER TABLE "DesignSessionBrainstormFeature" DROP COLUMN bucket
--           se SELECT COUNT(*) WHERE bucket IS NOT NULL = 0
```

Pre-flight obrigatório antes:
```sql
SELECT COUNT(*) FROM "DesignSessionBrainstormFeature" WHERE bucket IS NOT NULL;
```
Se >0, **manter coluna** — alguém ainda escreve. Se =0, drop.

**Cleanup TS:**
- Deletar `src/app/api/design-sessions/[id]/steps/[stepKey]/route.ts` (preservar `/notes/`).
- Deletar `getStepData`/`updateStepData` de `context.ts`.
- `npm run db:types`.

---

## 7. Métricas alvo — agora com baseline

Preencher coluna "Hoje" no PR 0 (baseline). Critério de sucesso: tudo na coluna "Alvo" tem que bater.

| Métrica | Hoje | Alvo |
|---|---|---|
| System prompt tokens (briefing Zelar) | ? | -30% |
| Tool calls médio por turn | ? | -25% |
| Tokens em tool results por turn | ? | -70% (default seco) |
| Latência loadContext | ? | -1 query (sem getStepDataForPrompt) |
| Read-modify-write writes | 100% | 0% |
| Latência UI ver escrita do Vitor | ~∞ (hard refresh) | <500ms (realtime) |
| Divergência Vitor↔UI | sim | **zero** |

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Realtime gera ruído em sessão com 5+ tabs | `useDesignSessionRealtime` debounce 100ms por entidade. Já é padrão no `useNotifications`. |
| Modelo confunde `write_persona({action:'update'})` com `write_brainstorm({action:'create'})` | Naming consistente `write_<entidade>`. Schema Zod por tool valida `action` e força `id` em update/delete. Erro vira tool result, modelo retry. |
| RPC `persona_journey_upsert` race entre Vitor e UI | RPC é atômica (única UPDATE no row da persona). Last-write-wins no nível do step — mesmo que CRDT seria over-engineering. |
| Edge function `export-design-session` quebra | Migrar no PR 2 (commit 4). Smoke test: rodar export numa sessão e diff o output. |
| Replay de histórico de chat antigo bate em tool results de `get_step_data` | Tool results no histórico não são re-executados — só servem de contexto pro modelo. Quebra é cosmética. |
| Cache miss no primeiro turn pós-deploy | Esperado. Custo pontual de ~80k tokens × N sessões ativas. Aceitável. |
| Scope/journey via RPC inline jsonb fica lento se array crescer >1k itens | Não vai acontecer (journey raramente passa de 10 steps, scope idem). Se acontecer, extrai pra tabela depois. |

---

## 9. O que NÃO está neste plano

- Memory tools (`record_decision`, etc.) — já tipadas, sem step_data.
- Story/task tools — já vivem em tabelas próprias.
- CI step types (`retrospective`, `new_demands`) — quando implementados, seguem o padrão `read_X`/`write_X`.
- Mudar engine/loop/step budget.
- Mudar prompt cache strategy (`stable`/`volatile` split de `engine.ts:41` já está certo).
- Colaboração CRDT — last-write-wins é suficiente.

---

## 10. Decisões tomadas (não-pendentes)

| Decisão v1 (pendente) | v2 |
|---|---|
| Persona journey: jsonb (A) ou tabela (B)? | **(A) com RPC**, mantém shape junto da persona. |
| A/B flag? | **Sem flag.** Janela aberta. |
| Quantos PRs? | **3.** Reads+prompt+realtime / writes+cutover / drop 24h depois. |
| Quando dropar legacy? | **+24h após PR 2 em prod** (pega rota fria). |
| Tools genéricas como facade? | **Não.** Remoção atômica no PR 2. |
| Coluna `BrainstormFeature.bucket` obsoleta? | **Validar SELECT no PR 3.** Drop se vazia. |

---

## 11. Definition of Done

- [ ] Baseline anotado (Fase 0).
- [ ] PR 1 merged + 2 tabs vendo realtime ao vivo.
- [ ] PR 2 merged + pre-flight `rg` retorna zero hits funcionais.
- [ ] 5 conversas Vitor (1 por sub-phase) sem regressão.
- [ ] Métricas §7 batem alvo com baseline.
- [ ] PR 3 merged 24h depois.
- [ ] `DesignSessionStepData` não existe mais.
- [ ] Memory `project_design_session.md` atualizada removendo menção a step_data legado.
