# Plano: Vitor Inteligente — Memória Estruturada + Disciplina de MVP

Status: aprovado, aguardando início da Fase 1
Última atualização: 2026-04-27 (rewrite)

## Tese

Vitor inteligente ≠ Vitor com memória. Memória é **necessária mas insuficiente**. Pra Vitor "lembrar do projeto, ter contexto de negócio e olho no MVP", precisamos de:

1. **Memória estruturada** (tabelas, não só markdown) — pra que decisões, perguntas abertas e business context sejam consultáveis por tipo, não relidos como blob.
2. **Camada de business context** — modelo, stage, ICP, runway. Sem isso, todo trade-off de MVP é teatro.
3. **Gates de disciplina** — `mvp_check` como tool que **bloqueia** proposta sem evidência+dor+constraint, não prompt rule frouxa.
4. **Sinal de incerteza** — Vitor distingue `hard_fact` / `inferred` / `assumption` em cada escrita, e revisita perguntas abertas antes de propor.
5. **Eval suite** — 10 conversas-douradas medindo qualidade real (detectou contradição? citou fonte? cortou escopo?), não vaidade (% chamadas capturadas).

Cada um sozinho é incompleto. Juntos = Vitor que **entende antes de agir**.

## Diagnóstico — onde Vitor "esquece" hoje

1. **Web search é volátil.** [tools/web-search.ts:18](../src/lib/agent/tools/web-search.ts#L18) executa, retorna, vira ruído de tool-call. Briefings citam pesquisa sem ref à fonte.
2. **Sessões são silos.** [agents/vitor/index.ts:25](../src/lib/agent/agents/vitor/index.ts#L25) só carrega `buildSessionContext(sessionId)`. Segunda design session do mesmo projeto começa do zero.
3. **Decisões enterram no chat.** Argumento construído no turno 3 ("Camila é primária porque X") precisa ser re-derivado no turno 40.
4. **Histórico longo trunca.** `messageHistory` cresce, comprime, nuance some.
5. **Step data ≠ raciocínio.** `DesignSessionStepData` guarda *output*, não *porquê* nem *descartado*.
6. **Não tem contexto de negócio.** Vitor sabe persona mas não sabe ticket médio, runway, ICP. Não consegue pesar trade-off econômico.
7. **Não registra o que não sabe.** Inventa pra preencher silêncio (por isso hipóteses ficam fracas).
8. **Não tem disciplina de MVP.** Aceita "tudo é MVP" porque a única defesa é prompt rule cosmético.

## Arquitetura — 4 camadas

```
┌─────────────────────────────────────────────────────────┐
│  PROJECT MEMORY (cross-session, durável)                │
│  - businessContext (1:1 Project — modelo, stage, ICP)   │
│  - projectMemoryMd (narrativa de projeto)               │
│  - decisions ativas agregadas das sessions              │
└─────────────────────────────────────────────────────────┘
              ↑ contribui no fim da session
┌─────────────────────────────────────────────────────────┐
│  SESSION MEMORY (escopo session)                        │
│  - sessionMemoryMd (narrativa curada)                   │
│  - decisions (estruturadas, com status)                 │
│  - openQuestions (estruturadas, com aging)              │
│  - research (auto-capturado de web_search)              │
└─────────────────────────────────────────────────────────┘
              ↑ via tools, no turno
┌─────────────────────────────────────────────────────────┐
│  WORKING MEMORY (turno atual)                           │
│  - intenção do usuário neste turno                      │
│  - hipótese sendo testada                               │
└─────────────────────────────────────────────────────────┘
              ↑ não persiste — vive no system prompt
┌─────────────────────────────────────────────────────────┐
│  STEP DATA (já existe — não duplicar)                   │
│  - DesignSessionStepData                                │
└─────────────────────────────────────────────────────────┘
```

**Princípio de não-duplicação:** structured tables (`decisions`, `openQuestions`, `businessContext`) carregam o **status e a meta-info** (when, why, by whom, supersededBy). Markdown carrega **narrativa** (parágrafo de contexto, raciocínio descartado). Step data carrega **output do wizard**. Cada coisa em seu lugar.

## Schema

```sql
-- Project-level
ALTER TABLE "Project"
  ADD COLUMN "memoryMd" text,
  ADD COLUMN "memoryUpdatedAt" timestamptz,
  ADD COLUMN "memoryVersion" integer NOT NULL DEFAULT 0;

CREATE TABLE "ProjectBusinessContext" (
  "projectId" uuid PRIMARY KEY REFERENCES "Project"(id) ON DELETE CASCADE,
  "businessModel" text,           -- "B2B SaaS", "marketplace", "serviço gerenciado"
  "stage" text,                   -- "pre-revenue", "early traction", "scaling"
  "icp" text,                     -- 1 parágrafo: quem paga, segmento, tamanho
  "ticketRangeBrl" int4range,     -- ex: [200, 500] — usado em mvp_check
  "runwayMonths" integer,         -- restrição econômica explícita
  "competitors" jsonb,            -- [{name, role: "reference|antiPattern"}]
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "updatedBy" uuid                -- quem (humano ou agente) atualizou
);

-- Session-level
ALTER TABLE "DesignSession"
  ADD COLUMN "memoryMd" text,
  ADD COLUMN "memoryAbstract" text,
  ADD COLUMN "memoryUpdatedAt" timestamptz,
  ADD COLUMN "memoryVersion" integer NOT NULL DEFAULT 0;

CREATE TABLE "DesignDecision" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  statement text NOT NULL,        -- "iOS fora do MVP"
  rationale text NOT NULL,        -- "time sem expertise + Android cobre 78%"
  confidence text NOT NULL,       -- "hard_fact" | "inferred" | "assumption"
  status text NOT NULL DEFAULT 'active',  -- "active" | "under_review" | "reverted"
  "supersededBy" uuid REFERENCES "DesignDecision"(id),
  tags text[],                    -- ["scope", "platform", "compliance"]
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "createdBy" text NOT NULL,      -- "vitor" | userId
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "DesignOpenQuestion" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  question text NOT NULL,
  "blocksWhat" text,              -- "decisão de stack", "definição de persona primária"
  status text NOT NULL DEFAULT 'open',  -- "open" | "answered" | "obsolete"
  answer text,
  "answeredAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "DesignSessionResearch" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionId" uuid NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
  "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
  query text NOT NULL,
  summary text NOT NULL,
  sources jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON "DesignDecision" ("projectId", status, "createdAt" DESC);
CREATE INDEX ON "DesignDecision" ("sessionId", status);
CREATE INDEX ON "DesignOpenQuestion" ("sessionId", status);
CREATE INDEX ON "DesignSessionResearch" ("sessionId", "createdAt" DESC);
CREATE INDEX ON "DesignSessionResearch" ("projectId", "createdAt" DESC);
```

### RLS

Replica padrão do `DesignSession`:
- **PM/Admin do projeto:** read em tudo.
- **Builder alocado** (linha em `ProjectMember`): read em tudo.
- **Outros:** bloqueado.
- **Escrita do agente:** service_role via tools.
- **Escrita humana:** apenas PM/Admin via UI, e só em campos específicos (`businessContext` completo; `openQuestions` pode marcar como obsoleto; `decisions` pode marcar como `under_review`). **Não editam markdown direto** — Vitor é dono da narrativa.

## Estrutura do `sessionMemoryMd` (narrativa)

Markdown carrega só o que **não cabe em tabela**. Seções fixas (instruída no system prompt):

```markdown
## Contexto Específico desta Session
[1 parágrafo: foco desta session, momento, gatilho]

## Personas Estabelecidas
- **Camila** (admin de salão): perde 2h/mês com fatura manual. Confirmada em 2026-04-20.
  Confidence: hard_fact (entrevista direta).

## Hipóteses (resumo)
- ✅ "Push em < 2min aumenta conversão em 30%" — confirmada via 3 entrevistas (research#a3f1).
- ❌ "Checkout em 1 toque" — refutada, compliance exige confirmação.

## Pesquisas Relevantes (curado)
- Ticket médio SaaS BR pra PME: R$ 200-500/mês (research#a3f1, 2026-04-19).
  → consistente com `ProjectBusinessContext.ticketRangeBrl`.

## Descartado e Por Quê
- Marketplace bidirecional: caro pro MVP, foco em demanda primeiro.
  → não vira `decision` porque é nuance de discussão, não compromisso.
```

**O que NÃO vai no markdown** (porque tem tabela):
- Decisões ativas → `DesignDecision`
- Perguntas abertas → `DesignOpenQuestion`
- Modelo de negócio, ICP, runway → `ProjectBusinessContext`
- Logs de research → `DesignSessionResearch`

## Estrutura do `Project.memoryMd` (Project Memory)

Cross-session, durável. Atualizado quando session encerra (auto-compact pede ao Vitor "o que vale lembrar pro projeto") ou quando PM faz handoff.

```markdown
## Visão de Produto (consolidada)
[atualizada à medida que sessions inception/CI refinam]

## Aprendizados Cruciais
- 2026-04-20: time não tem expertise iOS. Impacta priorização de plataforma.
- 2026-04-22: ticket médio confirmado em R$ 280 (média de 3 fornecedores).

## Riscos Conhecidos
- Compliance pode exigir auditoria adicional se persistirmos sessão > 24h.

## Padrões de Decisão deste Projeto
[opcional — se o projeto tem viés conhecido (ex: "preferimos buy over build")]
```

## Tools (todas Vitor-only, exceto onde marcado)

### Memória estruturada

```ts
// Decisions
record_decision({ statement, rationale, confidence, tags? })
  → { id, status: "active" }
  // Cria DesignDecision. Em "vamos focar em X", Vitor chama isso.

revise_decision({ id, newStatement?, newStatus, supersededByNew? })
  → { id, oldStatus, newStatus }
  // Marca como under_review ou reverted. Cria nova decisão se substituída.

list_decisions({ scope: "session" | "project", status?, tags? })
  → DesignDecision[]
  // Lê o estado atual. Padrão de uso: ANTES de propor algo que toca scope.

// Open Questions
add_open_question({ question, blocksWhat? })
  → { id }
  // Vitor registra o que NÃO sabe. Obrigatório quando ele faz "vou assumir X por enquanto".

resolve_open_question({ id, answer })
  → { id }
  // Quando o usuário responde a pergunta aberta, Vitor fecha.

list_open_questions({ scope: "session" | "project", status?: "open" })
  → DesignOpenQuestion[]
  // Vitor relê antes de propor. Se proposta depende de pergunta aberta, ele puxa.

// Research (auto-capturado, mas Vitor pode listar)
list_research({ scope, query?, limit? })
  → DesignSessionResearch[]
```

### Markdown narrativo

```ts
read_session_memory({ sessionId? })  // default: current session
  → { md, version, abstract, updatedAt }

update_session_memory({
  action: "replace" | "append_section" | "edit_section",
  section?: string,
  content: string,
  expectedVersion: number
})
  → { success, newVersion } | { success: false, currentVersion, currentMd }

read_project_memory()
  → { md, version, businessContext, activeDecisions, openQuestions }
  // Tudo project-level num shot. Único call no início de session nova.

update_project_memory({ action, section?, content, expectedVersion })
  → equivalent
```

### Business context

```ts
read_business_context()
  → ProjectBusinessContext

update_business_context({
  field: "businessModel" | "stage" | "icp" | "ticketRangeBrl" | "runwayMonths" | "competitors",
  value: any,
  expectedUpdatedAt: string  // optimistic concurrency
})
  → { success } | { conflict, currentValue }
  // PM pode chamar via UI também. Vitor chama quando usuário fornece.
```

### MVP gate

```ts
mvp_check({
  featureProposal: {
    title: string,
    targetPersona: string,
    painPointRef: string,    // step + id da dor em personas_journeys
    estimatedFp?: number,
  }
})
  → {
    pass: boolean,
    blockers: string[],       // ex: ["sem evidence em research", "não cobre dor priorizada"]
    warnings: string[],       // ex: ["FP alto vs runway"]
    suggestion: "MVP" | "Next" | "Out" | "needs_more_info"
  }
  // OBRIGATÓRIO antes de set_bucket("mvp"). Sem pass=true, set_bucket recusa.
```

### Cross-session

```ts
list_project_sessions()
  → [{ id, title, type, status, updatedAt, abstract }]

read_session_memory({ sessionId })  // já listada acima — aceita id de outra session do mesmo projeto
```

### Versioning + auto-update

- `expectedVersion` em todo update markdown — conflito retorna estado atual.
- Após `update_session_memory`, abstract regenerado por truncate (200 chars). Fase 2 evolui pra Haiku se ficar ruim.
- Após `update_business_context`, `Project.memoryUpdatedAt` bumpa.

## Auto-captura de research (sem LLM no meio)

Wrapper em [tools/web-search.ts:18](../src/lib/agent/tools/web-search.ts#L18). Após retornar resultado pro LLM, em background:

```ts
await db().from("DesignSessionResearch").insert({
  sessionId,
  projectId,
  query,
  summary: response.answer ?? results.map(r => r.title).join("; "),
  sources: results.map(r => ({
    title: r.title,
    url: r.url,
    snippet: r.content?.slice(0, 500),
  })),
});
```

Sem decisão do Vitor. Pesquisa nunca some. Vitor depois cura narrativa em `sessionMemoryMd` referenciando `research#<short-id>`.

## Carregamento no `loadContext`

Atualizar [agents/vitor/index.ts:14](../src/lib/agent/agents/vitor/index.ts#L14):

```ts
async loadContext(req) {
  const { sessionId, currentStepKey } = req.params;

  const { data: session } = await db()
    .from("DesignSession")
    .select("title, type, projectId, memoryMd, memoryVersion")
    .eq("id", sessionId).single();

  const [
    sessionContext,
    currentStepData,
    sessionIndex,
    activeDecisions,
    openQuestions,
    projectMemory,
    businessContext,
  ] = await Promise.all([
    buildSessionContext(sessionId),
    getStepData(sessionId, currentStepKey),
    db().from("DesignSession")
      .select("id, title, type, status, updatedAt, memoryAbstract")
      .eq("projectId", session.projectId)
      .neq("id", sessionId)
      .order("updatedAt", { ascending: false })
      .limit(10),
    db().from("DesignDecision")
      .select("id, statement, rationale, confidence, tags, createdAt")
      .eq("projectId", session.projectId)
      .eq("status", "active")
      .order("createdAt", { ascending: false }),
    db().from("DesignOpenQuestion")
      .select("id, question, blocksWhat, createdAt")
      .eq("sessionId", sessionId)
      .eq("status", "open"),
    db().from("Project")
      .select("memoryMd, memoryVersion")
      .eq("id", session.projectId).single(),
    db().from("ProjectBusinessContext")
      .select("*").eq("projectId", session.projectId).maybeSingle(),
  ]);

  return {
    sessionId,
    projectId: session.projectId,
    sessionTitle: session.title,
    sessionType: session.type,
    currentStepKey,
    sessionContext,
    currentStepData,
    sessionMemoryMd: session.memoryMd,
    sessionMemoryVersion: session.memoryVersion,
    projectMemoryMd: projectMemory.data?.memoryMd,
    projectMemoryVersion: projectMemory.data?.memoryVersion,
    businessContext: businessContext.data,
    activeDecisions: activeDecisions.data ?? [],
    openQuestions: openQuestions.data ?? [],
    sessionIndex: sessionIndex.data ?? [],
  };
}
```

### Token budget e ordem no prompt

Ordem importa pra prompt cache (Anthropic, 5min TTL):

```
[CACHE-STÁVEL — muda raramente, candidato a cache]
1. System base + tool defs
2. Project Memory (md + business context + decisions ativas)
3. Session Memory (md, sessionIndex)

[CACHE-VOLÁTIL — muda turno a turno]
4. Open Questions (status muda)
5. Step data atual
6. Mensagem do usuário
```

Se `sessionMemoryMd` + `projectMemoryMd` + decisions excederem **3000 tokens**, comprime:
- Sessions arquivadas no `sessionIndex` viram só id+title (sem abstract).
- Decisions com `tags` irrelevantes pro step atual viram resumo de 1 linha.
- Markdown tem hard cap por seção (400 tokens) — Vitor recebe alerta no prompt: "seção X passou do limite, considere consolidar".

## Comportamentos do Vitor (instruções de prompt)

### 1. Lê estruturado antes de tudo

Antes de qualquer sugestão substancial, ordem:
1. Estado já carregado no prompt (memória, decisions, open questions, business context).
2. `list_research` se a sugestão envolve mercado/concorrente/preço.
3. `list_decisions({ tags: relevantes })` se a sugestão toca scope.
4. `get_step_data` dos steps relacionados.
5. **Se alguma open question relevante está aberta há > 7 dias, levanta antes de propor.**

### 2. Cita fontes com confidence

Toda sugestão substancial termina com **uma das três etiquetas**:
- `(ref: research#a3f1, ProjectBusinessContext.ticketRange)` — hard_fact
- `(inferido de: persona Camila + research#b2d4)` — inferred
- `(suposição minha — sem evidência)` — assumption

Sem etiqueta, a sugestão não sai. Builder lendo o brief sabe quanto pesar.

### 3. Surface contradições — agora estruturalmente

Se usuário disser "vamos focar em iOS" e existe `DesignDecision` ativa "iOS fora do MVP":

> "Em 2026-04-20 ficou decidido iOS fora do MVP por X (DesignDecision#abc). Antes de seguir, **estou marcando como `under_review`**. Confirma a mudança? Se sim, eu reverto a decisão antiga e crio uma nova."

Vitor chama `revise_decision(id, status: "under_review")` **imediatamente** — não fica em silêncio assumindo que mudou. Se usuário confirma, `revise_decision(id, status: "reverted") + record_decision(novo)`.

### 4. Cross-session pollination ativa

Em session com memória vazia, primeira ação: `read_project_memory()` (1 call que traz tudo project-level).

Se Project Memory tem aprendizados ou business context, Vitor abre com:

> "Lendo memória do projeto: ICP é {x}, ticket {y}, decisões ativas: {z}. Vou usar isso de baseline. Algo mudou que eu deveria saber antes?"

### 5. Propostas de feature ancoradas em 3 fontes + mvp_check

No `brainstorm`/`prioritization`, cada feature proposta amarra:
- **Dor** (step `personas_journeys`)
- **Evidência** (research log OU decision OU business context)
- **Constraint** (decisions ativas + business context)

Antes de marcar como MVP: `mvp_check(proposal)` é **chamada obrigatória**. Sem `pass: true`, `set_bucket("mvp")` retorna erro. Vitor explica o blocker pro usuário.

Se faltar dor/evidência/constraint mas o usuário insistir: Vitor cria com etiqueta `assumption` e abre `add_open_question` registrando o gap.

### 6. Briefing tasks com refs cruzadas

Cada task que cite mercado/concorrente/preço carrega `**Ref:** research#XXX` no `notes`. Tasks que dependem de decisão ativa carregam `**Decision:** DesignDecision#abc`.

### 7. Auto-write em momentos-chave (com confidence + dedup)

Vitor escreve estruturado nos triggers, **com etiqueta de confidence**:

| Trigger | Tabela | Confidence |
|---|---|---|
| "vamos focar em X" / "X fora" / "Y é prioridade" | `DesignDecision` | hard_fact |
| "não pode Z" / "compliance exige W" | `DesignDecision` (tag: "constraint") | hard_fact |
| Persona confirmada após validação | atualiza `personas_journeys` step + linha em sessionMemoryMd | hard_fact |
| Web search sustenta sugestão aceita | `DesignSessionResearch` (auto) + linha em sessionMemoryMd | inferred |
| Vitor inferiu padrão | sessionMemoryMd seção "Hipóteses" | inferred |
| Vitor está chutando | `DesignOpenQuestion` (não vira decisão) | — |

Cada escrita estruturada acompanha mensagem curta:

> 📝 anotei: "iOS fora do MVP" como decisão (hard_fact). Pra reverter mais tarde, é só me avisar.

**Dedup:** antes de `record_decision`, Vitor faz `list_decisions` e checa se já existe `statement` similar. Se existir, atualiza a existente em vez de duplicar.

### 8. Open Questions — registrar o que não sabe

Sempre que Vitor for chutar, primeiro `add_open_question`:

> 📝 não temos confirmação se a integração com pagamento permite refund parcial. Anotei como pergunta aberta. Por enquanto vou assumir que sim — se for não, isso afeta a task VLD-058.

Em todo `loadContext`, Vitor recebe a lista de open questions. **Toda 5ª resposta**, ele puxa uma open question relevante:

> Antes de seguir: ainda está aberto "permite refund parcial?". Conseguiu confirmar?

### 9. Limpeza de memória obsoleta — agora estrutural

Decisão revertida = `revise_decision(id, status: "reverted")` + `record_decision(novo)`. Markdown só ganha 1 linha em "Personas/Hipóteses/Descartado" se houver narrativa. Não duplica.

### 10. Auto-compact ao fim da session

Quando session vai pra `status: "completed"`, Vitor é acionado uma última vez com prompt:

> Resuma pra Project Memory: 3-5 aprendizados cruciais, riscos descobertos, padrões de decisão. Output em markdown apendado em Project.memoryMd.

Saída vira `update_project_memory(action: "append_section", section: "Aprendizados Cruciais")`.

## UI — aba "Memória" (read + edição mínima do PM)

Aba nova no [layout da DesignSession](../src/app/(dashboard)/agents/[slug]/layout.tsx):

### Para todos (Builder/PM/Admin)
- **Markdown renderizado** (`sessionMemoryMd`) com seções
- **Decisions ativas** em tabela com filtro por tag
- **Open Questions** com idade (badge vermelho se > 7 dias)
- **Timeline de research** com sources clicáveis
- **Versão e última atualização**

### Para PM/Admin (escrita mínima)
- Botão `marcar como obsoleto` em open questions
- Botão `marcar como under_review` em decisions
- Form de `BusinessContext` editável (project-level)

**Não há editor de markdown** — banner: "Memória narrativa é mantida pelo Vitor. Pra ajustar, peça no chat. Decisões e perguntas têm controle direto aqui."

Aba "Project Memory" no nível do projeto: agrega Project.memoryMd + BusinessContext + decisions ativas cross-session.

## Eval suite — provando que ficou inteligente

Sem isso, "Vitor inteligente" é claim. Crie [eval/vitor/](../src/eval/vitor/) com 10 conversas-douradas. Cada uma:

```yaml
name: "contradição com decisão prévia"
setup:
  decisions:
    - { statement: "iOS fora do MVP", rationale: "...", status: "active" }
turns:
  - user: "vamos priorizar o app iOS pro MVP"
expected:
  - tool_called: "revise_decision"
    args.status: "under_review"
  - response_contains: ["2026-", "decidido", "confirma"]
  - response_not_contains: ["claro!", "vou priorizar"]
```

Categorias mínimas:
1. Detecta contradição com decision ativa → marca under_review
2. Cita ref de research em sugestão derivada
3. Bloqueia MVP sem evidência (mvp_check fail)
4. Registra open question em vez de chutar
5. Lê Project Memory antes de propor em session nova
6. Cross-session: detecta persona já estabelecida
7. Confidence label correta (hard_fact vs assumption)
8. Compress quando memória > 3k tokens
9. Auto-compact ao fim de session: gera ≥ 3 aprendizados
10. Não duplica decision similar (dedup)

Roda com Claude Haiku como judge (custo baixo) ou rule-based onde possível. Métrica: **% pass das 10**, baseline antes da Fase 1, alvo ≥ 80% pós-Fase 3.

## Faseamento (revisto)

| Fase | Escopo | Risco | Entregáveis |
|---|---|---|---|
| **0** | Eval suite com 10 conversas-douradas. Roda contra Vitor atual. **Define baseline.** | Zero | `src/eval/vitor/*.yaml`, runner script, baseline report |
| **1** | Migrations (5 tabelas) + auto-capture de research + UI read-only do log + Business Context form (PM-editable) | Baixo — não muda comportamento do Vitor ainda | `supabase/migrations/YYYYMMDD_vitor_memory.sql`, wrapper em `web-search.ts`, página/aba research, form business context |
| **2** | Tools `record_decision`/`revise_decision`/`list_decisions` + `add_open_question`/`resolve` + `read/update_session_memory` + `read/update_project_memory` + `read_business_context` + carregamento atualizado em `loadContext` + comportamentos 1, 2, 3, 7, 8, 9 no prompt | Médio — Vitor pode escrever ruim no início | Tools em `lib/agent/tools/memory.ts`, update em `prompt.ts`, update em `agents/vitor/index.ts` |
| **3** | Tool `mvp_check` como gate + integração no prompt do `prioritization`/`brainstorm` + comportamento 5 | Médio — pode bloquear casos legítimos no início, calibrar via eval | Tool + prompt rules + warnings em telemetry |
| **4** | Cross-session: comportamento 4 + project memory load no início + auto-compact (comportamento 10) | Baixo | Hook em status change da session, prompt de compact |
| **5** | UI completa de memória (Decision/OpenQuestion controles pro PM, aba project memory) | Baixo | `<SessionMemoryTab />`, `<ProjectMemoryView />` |

**Ordem:** 0 → 1 → 2 → 3 → 4 → 5. Eval suite **antes** das mudanças — sem baseline, qualquer claim de "ficou melhor" é vazio.

## Métricas de sucesso (qualidade, não vaidade)

Vaidade (auxiliar, não primária):
- 100% de chamadas de `web_search` aparecem em `DesignSessionResearch`.
- Em sessions > 20 turnos, `sessionMemoryMd` tem ≥ 3 seções preenchidas.
- 0 conflitos de versão silenciosos (todos retornam erro estruturado).

Qualidade (primária — vem da eval suite):
- **Eval pass rate ≥ 80%** pós-Fase 4.
- **% de propostas MVP com `mvp_check.pass=true`** ≥ 90% pós-Fase 3 (mede disciplina).
- **Idade média de open questions abertas** < 5 turnos (mede follow-up).
- **% de sugestões com confidence label** ≥ 95% pós-Fase 2.
- **% de contradições detectadas** (eval cat 1) = 100% pós-Fase 2.

## Decisões cravadas

1. **Tipos de memória:** Project (cross-session, durável) + Session (markdown + estruturado) + Working (turno).
2. **Estruturado vs markdown:** decisions, open questions, business context, research → tabelas. Narrativa, descartado, hipóteses → markdown.
3. **Quem escreve:** Vitor via tools (todas tabelas + markdown). PM/Admin via UI em business context (full edit), decisions/open questions (status changes only).
4. **Quem lê:** Builder/PM/Admin via RLS.
5. **Confidence:** toda escrita carrega `hard_fact | inferred | assumption`. Visível no UI e no prompt.
6. **MVP gate:** `mvp_check` é tool obrigatória antes de `set_bucket("mvp")`.
7. **Open questions com aging:** > 7 dias = badge vermelho UI + Vitor relê em todo turno.
8. **Versioning:** optimistic lock em todo markdown via `memoryVersion`.
9. **Token budget:** soft cap 3k tokens em memória combinada; compress por relevância de tag/recency.
10. **Prompt cache:** ordem fixa (system → project memory → session memory → volátil) pra maximizar hit rate.
11. **Auto-compact:** session → completed dispara write em Project.memoryMd.
12. **Eval suite:** Fase 0, baseline antes, target ≥ 80% pós-Fase 4.

## Out-of-scope (movido pra outro doc)

- **Fill granular por step (Modos 1/2/3 + grafo de dependências)** — É melhoria de prompt do `pre_work`, não memória. Vai pra `docs/vitor-prework-modes.md` separado.

## Pontos abertos pós-MVP

- **Vector search:** se base passar de ~100k tokens por projeto, considerar pgvector + embedding em research/decisions. Hoje não justifica.
- **Memory aging proativa:** decisões hard_fact com > 90 dias viram lembrete pra Vitor reconfirmar. Fase 6+.
- **Multi-projeto cross-pollination:** aprendizados de um projeto sugerindo padrões pra outro (com filtro de tenant). Fase 6+.
- **Export da memória:** download zip (md + tabelas em jsonl). Útil pra handoff. Fase 6+.
- **Notificação UI de contradição:** badge na aba quando Vitor flagrou. Fase 6+.
