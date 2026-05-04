# APF Estimator V2 — Plano de Implementação

> Pipeline pra estimar Pontos de Função (APF/SISP 2.3) a partir de um repositório React + Vite + Supabase, gerando relatório no formato Prodesp.
>
> Referência teórica: [function-points-reference.md](./function-points-reference.md). V1 do plano: [apf-estimator-plan.md](./apf-estimator-plan.md).
>
> **O que mudou da V1:** abandona a tese "determinístico puro", introduz fase explícita de identidade funcional (dedupe), inverte o eixo do front pra rotas (não hooks), define regra anti-double-count entre layers, troca git-numstat por diff de inventário, e amarra cálculos antes mágicos (fator disciplina, pesos PAG/HARDC, cache key).

---

## 0. Contexto e premissas

- **Stack-alvo (fixo):** Vite + React + TypeScript + Supabase (Postgres + Edge Functions Deno).
- **Casos de uso reais:** SEPLAG-CE, Riple, PGF, Escalas Médicas — todos no mesmo stack.
- **Função:** estimativa interna pra precificação e dimensionamento. **Não substitui medição oficial Prodesp/SISP** — a planilha do métrico humano (ex: Levi) continua sendo a fonte oficial pra faturamento.
- **Consumidor:** rota admin-only no Volund (Fase 2). Antes disso, CLI local pra calibração.
- **Sem fixtures-gabarito:** não temos repos+commits das planilhas existentes pra calibrar contra ground-truth. Calibração é empírica e contínua.

### Não-objetivos

- Substituir contagem oficial SISP/IFPUG.
- Suportar stacks diferentes de React+Vite+Supabase nesta versão.
- Análise estática profunda (taint analysis, fluxo de dados).

### O que mudou na premissa

V1 dizia "determinístico, LLM só classifica ambíguos". Na prática isso não se sustenta:

- **Identidade funcional ≠ identidade de arquivo.** Mesma EE pode aparecer em 3 telas; CEs diferentes podem ter AST idêntico (lista vs busca por tag).
- **Hooks/componentes não são processos elementares.** A unidade de contagem no front é a **rota/screen**, e isso exige semântica — `useStats` pode ser SE, mas `useDebouncedSearch` não é nada.
- **Manutenção SISP é sobre funções, não arquivos.** `git numstat` mistura refactor com mudança funcional.

V2 reformula a tese: **auditável e reprodutível**, com LLM em pontos delimitados (identidade + classificação + manutenção via diff). Cache + `temperature: 0` + few-shot mantêm reprodutibilidade prática.

---

## 1. Princípio de design — auditável, não "determinístico"

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ 1. INVENTORY │ ► │ 2. IDENTITY  │ ► │ 3. CLASSIFY  │ ► │ 4. SCORE     │ ► │ 5. REPORT    │
│ AST/SQL/grep │   │ dedupe + key │   │ LLM Sonnet   │   │ tabela IFPUG │   │ md + xlsx    │
│ por rota+SQL │   │ (LLM + heur) │   │ tipo+manut   │   │ + deflators  │   │              │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
   reprodutível       LLM auditável      LLM auditável     reprodutível       reprodutível
```

| Etapa | Reprodutibilidade | Como |
|---|---|---|
| 1. Inventário de candidatos | ✅ AST puro | Parser SQL + AST TS, itera por rota + por migration |
| 2. **Identidade funcional** (NOVO) | ⚠️ LLM em casos não-óbvios | Chave canônica `{verb, entity, variant}`; heurística + LLM |
| 3. Classificação tipo IFPUG | ⚠️ LLM domínio fechado | Sonnet 4.6 `temperature: 0` + few-shot |
| 4. Classificação manutenção | ⚠️ LLM com diff de inventário | Compara inventário em 2 commits, não numstat |
| 5. DET / RLR / ALR | ✅ contagem AST | Colunas, tabelas referenciadas, FKs |
| 6. Lookup complexidade | ✅ tabela | Matriz IFPUG do reference.md |
| 7. Aplicação deflator + disciplina | ✅ tabela | `mapping.yaml` versionado |

**Honestidade:** duas execuções do mesmo commit + mesma versão de prompt + mesmo `mapping.yaml` produzem o mesmo resultado (cache). Mudou prompt ou modelo? Re-classifica e o relatório registra a versão. Isso é "auditável", não "determinístico".

---

## 2. Eixo de inventário — rotas e migrations, não arquivos soltos

A V1 iterava por arquivo (`*.tsx`, `*.ts`) e juntava sinais. V2 inverte: o estimador percorre **dois eixos paralelos**, e o resto é referência cruzada.

### 2.1 Eixo backend — Postgres como fonte de verdade dos dados

Itera por:
- Cada `CREATE TABLE` em `supabase/migrations/**/*.sql` → candidato a **ALI**.
- Cada `CREATE FUNCTION` em migrations → cross-ref com chamadas `.rpc()` no front pra decidir se é EE/SE/CE.
- Cada handler `serve()` em `supabase/functions/**/index.ts` → candidato a EE/SE/AIE conforme método HTTP + tabelas tocadas.

### 2.2 Eixo frontend — rota é a unidade

Itera por **rota** (não por hook, não por componente):
- Detecta rotas em `src/routes/**`, `src/app/**` (file-system routing) ou via parse do router (`createBrowserRouter`, `<Route>`).
- Pra cada rota, coleta **transitivamente** todos os `supabase.from(...)`, `supabase.functions.invoke(...)`, `.rpc(...)` alcançáveis via grafo de imports a partir do componente raiz da rota.
- Hooks/componentes utilitários (`useDebouncedSearch`, `useCurrentUser`, `usePermissions`) **não são unidades** — só contribuem queries pras rotas que os usam.

**Resultado:** uma rota tipicamente vira 1 CE (lista), ou 1 CE + 1 EE (lista + criar), ou 1 SE (dashboard). Hooks de leitura usados em N rotas viram parte de N candidatos diferentes — a deduplicação na fase 3 decide se são a mesma função.

### 2.3 Regra anti-double-count entre camadas

Quando o mesmo write existe em mais de uma camada, **a função IFPUG mora na camada mais próxima do banco**. Ordem de prioridade:

1. **Função SQL** (`CREATE FUNCTION ... AS $$ INSERT ... $$`) — se existe RPC chamado pelo front, a EE é a função SQL. O `.rpc()` no front é só *referência*.
2. **Edge Function** com persistência — se a edge insere/atualiza, a EE é a edge. `supabase.functions.invoke(...)` no front é referência.
3. **Cliente Supabase direto** (`supabase.from('x').insert(...)` no front) — fallback quando não há RPC nem edge cobrindo o write.

Isso resolve o caso onde o front chama uma edge que insere: contamos **1 EE** (a edge), não 2.

---

## 3. DE ↔ PARA — onde o IFPUG mora no código

> Mantém-se o coração da V1, com ajustes de filtro/regra. Tudo que está abaixo vira `mapping.yaml`.

### 3.1 ALI — peso 7/10/15

| Sinal | Local | DET | RLR |
|---|---|---|---|
| `CREATE TABLE x` | `supabase/migrations/**/*.sql` | Colunas excluindo `id`, `created_at`, `updated_at`, `deleted_at`, FKs simples | Tabela principal + tabelas filhas obrigatórias (FK + `ON DELETE CASCADE` apontando pra ela) |

**Filtros:**
- Schemas `auth.`, `storage.`, `pg_*` → ignorar.
- Prefix `_internal_` ou comentário `-- internal` → ignorar.
- Tabela com 0 colunas de domínio → ignorar.
- **Junction table pura** (só 2 FKs + PK composta, sem colunas próprias) → não é ALI separada, vira RLR da tabela "dona" (heurística: a do lado N).

### 3.2 AIE — peso 5/7/10

| Sinal | Local | DET | RLR |
|---|---|---|---|
| `fetch('https://...')` ou SDK externo (não-Supabase, não auth/social) | `src/**/*.{ts,tsx}`, `supabase/functions/**/*.ts` | Campos do response **consumidos** | 1 default; +1 por nível de nesting consumido |

**Filtros:**
- Calls a `*.supabase.co` da própria app → não é AIE.
- Auth/social login (Google, GitHub, magic link) → infraestrutura, não AIE.
- Telemetria (Sentry, PostHog, Datadog) → não AIE.

### 3.3 EE — peso 3/4/6

| Sinal | Local | DET | ALR |
|---|---|---|---|
| `INSERT/UPDATE/DELETE` dentro de função SQL | migration | Args da função | Tabelas tocadas (incl. via trigger) |
| Edge function com método de escrita que persiste | `supabase/functions/**` | Campos validados do body (Zod/TS/destructure) | Tabelas usadas |
| `supabase.from('x').insert/update/upsert/delete` no front (só se não houver RPC/edge cobrindo) | `src/**` | Chaves do payload | Tabelas distintas tocadas |

**Filtros:**
- Insert em seed/setup script → ignorar.
- Insert em tabelas `_cache_*`, `_log_*` → ignorar.

### 3.4 SE — peso 4/5/7

| Sinal | Local | DET | ALR |
|---|---|---|---|
| Edge que retorna PDF/CSV/XLSX (`Content-Type: application/...`) | `supabase/functions/**` | Campos do output | Tabelas lidas |
| Função SQL com `SUM/COUNT/AVG/GROUP BY` | migration | Campos retornados | Tabelas em `FROM/JOIN` |
| **Rota** com nome ou conteúdo agregador (`/dashboard`, `/reports/*`, `*Stats`) | rota | Campos exibidos calculados | Tabelas consultadas |

**Heurística SE vs CE (resolvida pela LLM na fase 3):**
- CE: `SELECT colunas FROM t WHERE x = ?` sem agregação.
- SE: tem `GROUP BY` / `SUM` / `AVG`, ou JOIN de 3+ tabelas com cálculo, ou rota cujo propósito é exibir métrica derivada.

### 3.5 CE — peso 3/4/6

| Sinal | Local | DET | ALR |
|---|---|---|---|
| `supabase.from('x').select(...)` sem agregação, agregado **por rota** | rota | União de colunas em todos os `select` da rota | Tabelas distintas (incluindo embeds `select('*, related(*)')`) |
| RPC só-leitura sem agregação | migration + ref no front | Args + colunas retornadas | Tabelas em `FROM/JOIN` |

### 3.6 Manutenção SISP via diff de inventário (NÃO numstat)

V1 usava `git log --numstat` no arquivo, o que mistura refactor com mudança funcional. V2 deriva manutenção do **diff entre dois inventários**:

1. Roda inventário no commit `base`.
2. Roda inventário no commit `head`.
3. Pareia funções pela chave de identidade (fase 4).
4. Classifica:

| Estado | Manutenção | Deflator |
|---|---|---|
| Função existe no head, não no base | `I` (Inclusão) | 1.0 |
| Função existe nos dois, mesmo `{type, det, alr}` | nada (não conta) | — |
| Função existe nos dois, DETs ou ALRs mudaram | `A` + ratio | 0.5 / 0.75 / 0.8 / 0.9 |
| Função existe no base, não no head | `E` (Exclusão) | 0.4 |

**Ratio de alteração = `Δ(DET ∪ ALR) / max(DET ∪ ALR)_base`**, calculado sobre o conjunto de DETs+ALRs (não sobre linhas de código). Isso é o que SISP realmente mede: mudança funcional, não mudança textual.

**Default conservador:** se a chave de identidade é ambígua entre base e head (rename de tabela, split de função), classificar como `E + I` em vez de `A` e marcar `needs_review: true`.

**v1 pragmática:** se o usuário não passa `--base`, assume tudo `I` (deflator 1.0). Sem chute de manutenção.

### 3.7 Itens não mensuráveis (guia local Prodesp)

Contam **fora do IFPUG**, somando direto em PF-equivalentes:

| Sigla | Sinal | PF-equiv |
|---|---|---|
| `PAG` | Página estática (rota sem fetch nem mutation) | 0.6 por página |
| `DCDI` | Migration `INSERT INTO x VALUES (...)` com 1+ linha de dados de código | 1.0 por **bloco** (não por linha) |
| `DCFI` | `CREATE FUNCTION` em migration | 1.5 por função |
| `HARDC` | Constante de domínio **exposta ao usuário** (enum em `src/types/`, label visível) | 0.04 **por constante única**, capado em 5 PF totais |
| `DATDI` | Setup de full-text search (`CREATE INDEX ... USING gin`) | 4.9 por índice |

**Regra anti-explosão pra HARDC:** só conta enums/constantes que aparecem em UI (rotulados em componentes) ou em response de API. Enum interno de máquina de estado não conta. Cap total de 5 PF impede que `constants.ts` com 200 strings vire 8 PF.

---

## 4. Identidade funcional (NOVO — etapa 2 do pipeline)

A maior mudança da V2. Resolve antes da classificação, não depois.

### 4.1 O problema

```ts
// Tela A: app/contacts/page.tsx
useQuery(() => supabase.from('contacts').select('id, name, email').eq('org_id', orgId))

// Tela B: app/contacts/import/page.tsx
useQuery(() => supabase.from('contacts').select('id, name, email').eq('org_id', orgId))
```

Mesmo SQL, mesma tabela, mesmos DETs. **IFPUG conta 1 CE.** O inventário inocente conta 2.

```ts
// Tela C: app/contacts/page.tsx (mesma!)
useQuery(() => supabase.from('contacts').select('id, name, email, tags(name)').eq('tag_id', tagId))
```

Mesma tabela, DETs quase iguais, mas **propósito diferente**: "buscar por tag" vs "listar". **IFPUG conta 2 CEs.**

AST não distingue. Heurística simples (hash de query) confunde. Precisa de uma fase explícita.

### 4.2 Chave canônica de identidade

Toda função IFPUG tem uma chave:

```ts
type FunctionalIdentity = {
  verb: 'list' | 'detail' | 'search' | 'create' | 'update' | 'delete' | 'aggregate' | 'export' | 'import';
  entity: string;         // nome canônico da tabela/conceito ('contact', 'deal')
  variant?: string;       // 'by_tag', 'kanban', 'archived' — distingue CEs irmãs
};
```

Duas ocorrências com a mesma `(verb, entity, variant)` são **a mesma função** e devem ser deduplicadas (DETs viram união, ALRs viram união).

### 4.3 Como derivar a chave

**Heurística primeiro (resolve ~70%):**

- `verb`: do método (`insert→create`, `update/upsert→update`, `delete→delete`, `select sem agg→list`, `select com .eq('id',...)→detail`, `select com agg→aggregate`).
- `entity`: do nome da tabela ou da rota base (`/contacts/* → contact`).
- `variant`: vazio na maioria. Sinais explícitos: filtro principal (`eq`, `in`, `text search`), nome da rota (`/import → import`, `/kanban → kanban`).

**LLM resolve o resto (~30%):**

Quando duas ocorrências têm chave heurística idêntica mas SQL diferente, ou chave heurística diferente mas SQL idêntico — manda pra LLM com:
- as duas ocorrências (path, snippet, SQL, contexto da rota),
- a pergunta "essas são a mesma função IFPUG ou duas funções distintas? se duas, qual `variant` dá pra cada?",
- few-shot com 5-10 exemplos rotulados.

LLM produz a `variant` ou confirma o merge. Resultado vai pro cache `(item_signature_a, item_signature_b)`.

### 4.4 Saída

```ts
type IdentifiedItem = InventoryItem & {
  identity: FunctionalIdentity;
  // depois de dedupe:
  occurrences: { file: string; line: number; det_local: string[]; alr_local: string[] }[];
  det: string[];   // união de todos os DETs vistos
  alr: string[];   // união de todos os ALRs vistos
};
```

Pronto: cada `IdentifiedItem` é uma função IFPUG candidata, com DETs/ALRs já agregados.

---

## 5. Arquitetura

```
scripts/apf/
├── estimate.ts                  # entrypoint CLI
├── estimate.sh                  # wrapper bash
├── inventory/
│   ├── index.ts                 # orquestra
│   ├── parse-migrations.ts      # SQL → ALIs candidatas + funções SQL
│   ├── parse-edge-fns.ts        # serve() handlers
│   ├── parse-routes.ts          # ROTAS (file-system + router) → grafo de imports
│   ├── collect-route-queries.ts # transitivamente coleta queries por rota
│   ├── parse-rpcs.ts            # cross-ref entre src e migrations
│   └── layer-priority.ts        # aplica regra anti-double-count §2.3
├── identity/                    # NOVO
│   ├── index.ts                 # orquestra dedupe
│   ├── heuristic-key.ts         # deriva (verb, entity, variant) por regra
│   ├── llm-disambiguate.ts      # LLM pra casos não-óbvios
│   └── merge.ts                 # une ocorrências da mesma identidade
├── classify/
│   ├── index.ts                 # orquestra
│   ├── classify-type.ts         # tipo IFPUG (EE/CE/SE/AIE/ALI)
│   ├── classify-maintenance.ts  # I/A/A50/A75/A90/E via diff de inventário
│   ├── prompt.ts
│   └── client.ts
├── score/
│   ├── index.ts
│   ├── ifpug-tables.ts
│   ├── deflators-sisp.ts
│   ├── disciplina.ts            # cálculo explícito de fator disciplina (§7)
│   └── nao-mensuraveis.ts       # PAG/DCDI/DCFI/HARDC/DATDI
├── report/
│   ├── markdown.ts
│   └── xlsx.ts
├── mapping.yaml                 # DE→PARA + filtros + pesos + cap HARDC
├── version.ts                   # ESTIMATOR_VERSION, PROMPT_VERSION
└── types.ts
```

### Fluxo de tipos

```ts
// inventory/index.ts
type InventoryItem = {
  id: string;                       // hash estável (path + symbol + signature)
  source_file: string;
  source_line: number;
  layer: 'sql_function' | 'edge_function' | 'route_query' | 'migration';
  candidate_type: 'ALI' | 'AIE' | 'EE' | 'CE' | 'SE' | 'AMBIGUOUS';
  raw_signature: { sql?: string; method?: string; tables: string[]; columns: string[] };
};

// identity/index.ts
type IdentifiedItem = InventoryItem & {
  identity: { verb: string; entity: string; variant?: string };
  merged_from: string[];            // ids das ocorrências mescladas
  det: string[];
  alr: string[];
};

// classify/index.ts
type ClassifiedItem = IdentifiedItem & {
  type: 'ALI' | 'AIE' | 'EE' | 'CE' | 'SE';
  manutencao: 'I' | 'A' | 'A50' | 'A75' | 'A90' | 'E' | null;
  llm_reasoning?: string;
};

// score/index.ts
type ScoredItem = ClassifiedItem & {
  complexidade: 'Baixa' | 'Media' | 'Alta';
  pf_ifpug: number;
  deflator_sisp: number;
  fator_disciplina: number;
  pf_ajustado: number;
};
```

### Cache key (V2 — completa)

```ts
const cacheKey = hash({
  commit_sha,
  mapping_yaml_hash,
  estimator_version,    // bump manual quando muda parser/heurística
  prompt_version,       // bump manual quando muda prompt LLM
  llm_model_id,         // 'claude-sonnet-4-6'
});
```

Mudou qualquer um → invalida. Cache de identidade (LLM) e classificação (LLM) são caches secundários, hash-eados por `(item_signature, prompt_version, llm_model_id)`.

---

## 6. Roadmap de execução

### Fase 1 — CLI local (target: ~2 semanas, +1 semana vs V1)

**Objetivo:** `tsx scripts/apf/estimate.ts --repo /tmp/seplag-ce` produz relatório.

#### 1.1 Inventory (4 dias) — +1 dia vs V1
- [ ] `parse-migrations.ts` — `node-sql-parser`, extrai `CREATE TABLE`, FKs, `CREATE FUNCTION`.
- [ ] `parse-routes.ts` — detecta routes (file-system + react-router); produz grafo de imports.
- [ ] `collect-route-queries.ts` — itera transitivamente, agrega queries por rota.
- [ ] `parse-edge-fns.ts` — AST `@swc/core` pra `serve()` + métodos + body parsing.
- [ ] `parse-rpcs.ts` — cross-ref `.rpc('foo')` ↔ `CREATE FUNCTION foo`.
- [ ] `layer-priority.ts` — aplica regra anti-double-count.
- [ ] **Teste:** rodar no SEPLAG-CE, dump JSON, inspecionar.

#### 1.2 Identity (2 dias) — NOVO
- [ ] `heuristic-key.ts` — derivação de `(verb, entity, variant)` por regra.
- [ ] `llm-disambiguate.ts` — prompt + few-shot, batch dos pares ambíguos.
- [ ] `merge.ts` — une ocorrências, agrega DETs/ALRs.
- [ ] **Teste:** rodar no SEPLAG-CE, comparar count de candidatos pré/pós dedupe. Esperamos compressão de 30-50%.

#### 1.3 Classify (1.5 dias)
- [ ] `classify-type.ts` — Sonnet 4.6 com few-shot (~20 exemplos das 3 planilhas).
- [ ] `classify-maintenance.ts` — diff entre inventário do `--base` e `--head`.
- [ ] Cache per-item.
- [ ] **Custo estimado:** ~$0.10-0.30 por execução completa.

#### 1.4 Score (1 dia) — +0.5 dia vs V1 (disciplina explícita)
- [ ] Matriz IFPUG (de [function-points-reference.md](./function-points-reference.md)).
- [ ] Deflatores SISP do `mapping.yaml`.
- [ ] `disciplina.ts` — cálculo explícito (§7).
- [ ] `nao-mensuraveis.ts` — PAG/DCDI/DCFI/HARDC/DATDI com cap.

#### 1.5 Report (0.5 dia)
- [ ] Markdown: tabela por tipo + total + breakdown por arquivo + lista de `needs_review`.
- [ ] Header do report inclui: estimator_version, prompt_version, mapping_hash, model_id, commit_sha. Reproduzibilidade auditável.
- [ ] XLSX (formato Prodesp) opcional na Fase 1.

#### 1.6 Smoke test (1 dia)
- [ ] SEPLAG-CE → comparar com gut-feeling (faixa 150-300 PF, ver §9).
- [ ] Volund → mesma sanidade.
- [ ] Range de sprint (`--base HEAD~7d --head HEAD`) → simular medição quinzenal.

### Fase 2 — produção no Volund

#### 2.1 Backend
- [ ] Mover `scripts/apf/` core pra `src/lib/apf/`.
- [ ] Tabela `apf_estimates`: `id, project_id, commit_base, commit_head, total_pf_ifpug, total_pf_ajustado, breakdown jsonb, estimator_version, prompt_version, mapping_hash, model_id, generated_by, created_at`.
- [ ] Edge function `apf-estimate`: clona repo, roda pipeline, persiste, retorna.
- [ ] Cache hit em `(repo_url, commit_sha, mapping_hash, estimator_version, prompt_version, model_id)`.

#### 2.2 Frontend
- [ ] Página `/admin/apf` — gate `app_metadata.role === 'admin'` na DAL.
- [ ] Form: select project + base + head (sprint range pré-popula).
- [ ] Resultado: tabela detalhada + `needs_review` em destaque + botão "Export XLSX".
- [ ] Histórico por projeto.

#### 2.3 Calibração contínua
- [ ] Pra cada projeto com medição oficial, registrar `oficial_pf` na tabela.
- [ ] Dashboard `/admin/apf/calibration`: erro % por projeto, drift de mapping.
- [ ] Quando erro > 30%, abrir issue de ajuste de heurística.

---

## 7. Fator disciplina — explícito (NOVO)

V1 deixava `0.95` como mágica. V2 calcula:

```
fator_disciplina = Σ(% das fases entregues no escopo)
```

Fases SISP 2.3 e seus pesos default:

| Fase | Peso | Sinal no repo |
|---|---|---|
| Levantamento de requisitos | 0.05 | `docs/requisitos/`, design sessions linkadas (Volund) |
| Análise/projeto | 0.15 | ADRs em `docs/adr/`, design sessions com tasks promovidas |
| Implementação | 0.40 | código em `src/` e `supabase/` (sempre presente) |
| Testes | 0.15 | `*.test.ts`, `*.spec.ts`, pasta `e2e/` |
| Homologação | 0.10 | branch `staging` ativa, tag `release/*` |
| Documentação | 0.10 | `README.md`, `docs/` com >5 arquivos |
| Implantação | 0.05 | CI/CD config (`.github/workflows/`, cloudbuild) |

**Regra:** estimador detecta presença de cada fase via sinal e soma. Default razoável pra repo "completo" cai entre 0.85 e 0.95. CLI aceita `--disciplina <valor>` pra override manual.

**Por que isso importa:** num repo só com código (sem testes, sem docs, sem CI), o fator real é ~0.45. Aplicar 0.95 cego infla 2x. V2 não esconde isso.

---

## 8. Calibração sem ground-truth

### 8.1 Sanity-check inicial (Fase 1)
1. SEPLAG-CE inteiro (41 migrations, ~10 páginas) → faixa esperada **150-300 PF**.
2. Volund inteiro → mesma faixa, comparar com gut-feeling.
3. Fora dessa faixa por >2x = bug em inventory/identity/classify, não no edital.

### 8.2 Calibração com piloto (Fase 2)
1. Escolher 1 projeto novo + medição oficial em paralelo.
2. Após 2-3 medições, comparar deltas.
3. Ajustar `mapping.yaml`:
   - Subestimando → provavelmente perdendo SE (dashboards) ou items locais (PAG/HARDC).
   - Superestimando → identity merging falhando (mesma função contada várias vezes).

### 8.3 Métricas de saúde

- **Recall de funções:** das funções listadas pelo métrico humano, % que o estimator achou. **Meta: >85%.**
- **Precisão:** das funções do estimator, % que são funções de fato. **Meta: >80%.**
- **Erro de PF total:** `|estimado - oficial| / oficial`. **Meta: <30% após 3 calibrações.**

**Por que 30% e não 20% como na V1:** medições humanas divergem 15-25% entre métricos diferentes na mesma planilha. Esse é o piso de ruído. <30% = dentro do desacordo inter-humano + folga.

---

## 9. Decisões abertas (precisam input do João)

| # | Decisão | Default proposto |
|---|---|---|
| 1 | `mapping.yaml` em produção: repo ou DB editável? | Repo + versionado, edição via PR |
| 2 | Range default da estimativa | CLI: `--base/--head` explícitos; UI: select de sprint |
| 3 | Deps externas (Supabase auth, Stripe SDK) como AIE? | Não — só APIs de domínio do produto |
| 4 | shadcn/ui copy-pasted conta? | Não — UI primitives |
| 5 | Testes (`*.test.ts`) entram em PFT? | Não na v1 — só código de produção |
| 6 | Migrações de dados (seeds) → DCDI? | Sim, se >10 linhas e na pasta `supabase/migrations/` (não em `seeds/`) |
| 7 | **Como rotular few-shot da Identity (NOVO)?** | João + métrico revisam ~30 pares ambíguos do SEPLAG-CE; vira fixture |
| 8 | **Detecção de rota: file-system ou router?** | Auto-detect via heurística; se ambos presentes, file-system ganha |

---

## 10. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Identity LLM erra merging | Subestima ou superestima | Few-shot rotulado + cache; `needs_review` no relatório |
| LLM classifica tipo errado | Erro <30% | `temperature: 0` + few-shot + caps |
| Inventory perde funções em hooks customizados | Subestima | Eixo por rota captura via grafo de imports |
| Mapping diverge entre projetos | Estimates incomparáveis | Versionar mapping, header do report exibe versão |
| Repo gigante = custo LLM alto | Caro | Cache agressivo + batch + identity reduz N |
| Métrico humano discorda | Estimate "errada" | Aceitar — meta é precificação interna |
| Edital SISP muda | Quebra deflators | YAML versionado, fácil bump |
| **Dedupe agressivo demais (NOVO)** | Subestima | Few-shot enviesado pra "manter separadas em dúvida" |
| **Fator disciplina mal-detectado (NOVO)** | Infla/deflaciona PF total | Override manual `--disciplina <v>`, log dos sinais detectados |

---

## 11. Custo estimado por execução (Fase 1)

Repo do tamanho do SEPLAG-CE (41 migrations, ~10 páginas, ~30 hooks):

| Etapa | Tempo | Custo |
|---|---|---|
| Inventory (AST + grafo de imports) | ~8s | $0 |
| Identity (LLM ~10-15 pares ambíguos) | ~10s | ~$0.03 |
| Classify (LLM ~25 itens) | ~15s | ~$0.05 |
| Score + Report | ~1s | $0 |
| **Total** | **~35s** | **~$0.08** |

Re-execução com cache hit completo = $0. Cache parcial (mudou só prompt) = ~$0.05.

---

## 12. Sucesso

### Fase 1 concluída quando:
- [ ] `tsx scripts/apf/estimate.ts --repo /tmp/seplag-ce` produz relatório markdown.
- [ ] Total PF do SEPLAG-CE cai na faixa 150-300 PF.
- [ ] Re-execução com cache é instantânea.
- [ ] Output inclui breakdown por tipo + lista de `needs_review` + header com versões.
- [ ] `mapping.yaml` editável recalcula sem rebuild.
- [ ] Identity reduz contagem em 30-50% vs inventário cru no SEPLAG-CE.

### Fase 2 concluída quando:
- [ ] Admin loga em `/admin/apf`, escolhe projeto + range, vê estimativa em <30s.
- [ ] Estimativa fica persistida e re-calculável.
- [ ] Export XLSX abre no Excel/LibreOffice no formato Prodesp.
- [ ] Pelo menos 1 piloto rodou em paralelo com medição oficial.
- [ ] Erro vs oficial em pelo menos 1 projeto está <30%.

---

## Apêndice A — Diferenças V1 → V2 (resumo)

| Tópico | V1 | V2 |
|---|---|---|
| Tese | "Determinístico, LLM só classifica" | "Auditável, LLM em pontos delimitados" |
| Eixo do front | Por arquivo/hook | Por rota, com grafo de imports transitivo |
| Identidade funcional | Implícita ("dedup crítica") | Fase explícita §4, chave canônica `(verb, entity, variant)` |
| Manutenção SISP | `git numstat` (mistura refactor) | Diff entre dois inventários (mudança funcional) |
| Layers (front/edge/SQL) | Inventário soma todos | Regra de prioridade §2.3, conta na camada mais próxima do banco |
| Fator disciplina | Constante 0.95 | Cálculo explícito por sinais §7 |
| HARDC | `0.04 × N` sem cap | `0.04 × N`, cap 5 PF, só constantes user-facing |
| Cache key | `(commit, mapping)` | `+ estimator_version + prompt_version + model_id` |
| Roadmap Fase 1 | ~1 semana | ~2 semanas (Identity custa 2 dias) |
| Meta erro PF | <20% | <30% (alinha com ruído inter-humano) |
