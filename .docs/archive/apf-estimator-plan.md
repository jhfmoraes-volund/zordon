# APF Estimator — Plano de Implementação

> Pipeline para estimar Pontos de Função (APF/SISP 2.3) a partir de um repositório React + Vite + Supabase, gerando relatório no formato Prodesp.
>
> Referência teórica: [function-points-reference.md](../features/estimation/function-points-reference.md). Este documento foca **exclusivamente em como extrair PF de código**, não na teoria IFPUG.

---

## 0. Contexto e premissas

- **Stack-alvo (fixo):** Vite + React + TypeScript + Supabase (Postgres + Edge Functions Deno).
- **Casos de uso reais:** SEPLAG-CE, Riple, PGF, Escalas Médicas — todos no mesmo stack.
- **Função:** estimativa interna pra precificação e dimensionamento. **Não substitui medição oficial Prodesp/SISP** — a planilha do métrico humano (ex: Levi) continua sendo a fonte oficial pra faturamento.
- **Consumidor:** rota admin-only no Volund (Fase 2). Antes disso, CLI local pra calibração.
- **Sem fixtures-gabarito:** não temos repos+commits das planilhas existentes (Riple/PGF/Escalas) pra calibrar contra ground-truth. Vamos estimar "no escuro" e ajustar empiricamente conforme rodarmos em projetos reais com medição posterior.

### Não-objetivos

- Substituir contagem oficial SISP/IFPUG.
- Suportar stacks diferentes de React+Vite+Supabase nesta versão.
- Análise estática profunda (taint analysis, fluxo de dados). Usamos heurísticas de AST + LLM pra classificação ambígua.

---

## 1. Princípio de design — determinismo primeiro

A LLM **não** decide quantas funções existem nem calcula PF. Ela só atua como classificador em casos ambíguos.

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ 1. INVENTORY │ ───► │ 2. CLASSIFY  │ ───► │ 3. SCORE     │ ───► │ 4. REPORT    │
│ (AST/regex)  │      │ (LLM Sonnet) │      │ (tabela)     │      │ (md + xlsx)  │
│ determinístico│      │ classificação │      │ determinístico│      │ determinístico│
└──────────────┘      └──────────────┘      └──────────────┘      └──────────────┘
```

| Etapa | Determinístico? | Como |
|---|---|---|
| Inventário de funções candidatas | ✅ 100% | Parser SQL + AST TypeScript + grep estruturado |
| Cálculo de DET/RLR/ALR | ✅ 100% | Conta colunas, tabelas referenciadas, FKs |
| Classificação tipo IFPUG (EE/CE/SE) | ⚠️ LLM, mas espaço fechado (5 buckets) | Sonnet 4.6 com `temperature: 0` + few-shot |
| Manutenção (Inclusão/Alteração/Exclusão) | ⚠️ LLM com hint de `git log` | LLM olha histórico do arquivo |
| Lookup complexidade IFPUG | ✅ 100% | Tabela DET×ALR (do `function-points-reference.md`) |
| Aplicação deflator SISP + fator disciplina | ✅ 100% | Tabela `mapping.yaml` |

A LLM é um **discriminador**, não um gerador. Duas execuções do mesmo commit produzem o mesmo inventário e o mesmo cálculo; só a classificação pode variar (e em domínio fechado, com `temperature: 0`, varia pouco).

---

## 2. DE ↔ PARA — onde o IFPUG mora no código

Esta tabela é o coração do estimador. Define os sinais que o `inventory.ts` procura no repo.

### 2.1 ALI (Arquivo Lógico Interno) — peso 7/10/15

| Sinal | Local | Como contar DET | Como contar RLR |
|---|---|---|---|
| `CREATE TABLE x` | `supabase/migrations/**/*.sql` | Colunas da tabela, **excluindo** `id`, `created_at`, `updated_at`, `deleted_at`, FKs simples | Tabelas filhas obrigatórias (junction tables com FK + `ON DELETE CASCADE` apontando pra esta tabela) |
| `ALTER TABLE x ADD COLUMN` | mesmo | Soma colunas adicionadas (relevante pra contagem de melhoria) | — |

**Filtros:**
- Tabelas começando com `auth.`, `storage.`, `pg_` → ignorar (Supabase platform).
- Tabelas marcadas com prefix `_internal_` ou comentário `-- internal` → ignorar.
- Tabela com 0 colunas de domínio (só `id` + auditoria) → ignorar (não é entidade real).

### 2.2 AIE (Arquivo de Interface Externa) — peso 5/7/10

| Sinal | Local | Como contar DET | Como contar RLR |
|---|---|---|---|
| `fetch('https://...')` ou client SDK externo (não-Supabase) | `src/**/*.{ts,tsx}`, `supabase/functions/**/*.ts` | Campos do response que o código consome | 1 (default), aumenta se o response for nested |
| Edge function que chama API externa e retorna dados sem persistir | `supabase/functions/<name>/index.ts` | mesmo | mesmo |

**Filtros:**
- Chamadas a `https://*.supabase.co/...` da própria app → não é AIE (é a própria base).
- Calls de auth/social login → não é AIE (é infraestrutura).

### 2.3 EE (Entrada Externa) — peso 3/4/6

| Sinal | Local | Como contar DET | Como contar ALR |
|---|---|---|---|
| `supabase.from('x').insert/update/upsert/delete(...)` | `src/**/*.{ts,tsx}` | Chaves do objeto passado | Tabelas distintas tocadas (esta + qualquer outra via trigger/RPC chamada inline) |
| Edge Function `serve()` com método POST/PUT/PATCH/DELETE que persiste | `supabase/functions/**/index.ts` | Campos validados do request body (Zod schema, tipo TS, ou destructuring) | Tabelas usadas |
| RPC `supabase.rpc('fn', args)` onde `fn` faz `INSERT/UPDATE/DELETE` | match com função SQL na migration | Args da função SQL | Tabelas tocadas pela função |

**Filtros:**
- Insert dentro de seed/setup script → ignorar.
- Insert em tabelas-cache (ex: `_cache_xyz`) → ignorar.

### 2.4 SE (Saída Externa) — peso 4/5/7

| Sinal | Local | Como contar DET | Como contar ALR |
|---|---|---|---|
| Edge function que retorna PDF/CSV/XLSX (`Content-Type: application/...`) | `supabase/functions/**/index.ts` | Campos do output | Tabelas lidas pra montar |
| `.rpc('fn')` onde `fn` tem `SUM/COUNT/AVG/GROUP BY` | match SQL function | Campos retornados | Tabelas em `FROM/JOIN` |
| Componente que claramente agrega (`Dashboard`, `Report`, `*Chart`, `*Stats`) | `src/**/*.tsx` | Campos exibidos calculados | Tabelas consultadas |
| Hook que retorna dado derivado (`useStats`, `useReport`, `useDashboard*`) | `src/hooks/**/*.ts` | mesmo | mesmo |

**Heurística SE vs CE (resolvida pela LLM):**
- **CE:** `SELECT * FROM tabela WHERE x = ?` — LLM classifica como CE.
- **SE:** mesma query mas com `GROUP BY`, agregação, ou JOIN de 3+ tabelas com cálculo — LLM classifica como SE.

### 2.5 CE (Consulta Externa) — peso 3/4/6

| Sinal | Local | Como contar DET | Como contar ALR |
|---|---|---|---|
| `supabase.from('x').select(...)` sem agregação | `src/**/*.{ts,tsx}` | Colunas no `select()` (ou `*` → todas as colunas da tabela) | Tabelas no `select` (incluindo joins via `select('*, related(*)')`) |
| Hook `useQuery` que apenas lê dados | `src/hooks/**/*.ts` | mesmo | mesmo |
| `RPC` que só lê (sem write, sem agregação) | match SQL function | mesmo | mesmo |

**Deduplicação crítica:**
- Mesma query renderizada em 2 telas → conta 1 vez.
- Listagem + detalhe da mesma entidade → 2 CEs separadas (queries diferentes).
- Componente "lista de X" reutilizado em vários lugares → 1 CE.

### 2.6 Manutenção SISP (deflator)

Sinal vem de `git log --follow` no arquivo:

| Padrão git | Manutenção SISP | Deflator |
|---|---|---|
| Arquivo criado no range de commits analisado | `I` (Inclusão) | 1.0 |
| Arquivo existia, modificado no range, <50% das linhas mudaram | `A` (Alteração genérica) | 0.8 |
| Arquivo existia, 50-75% mudou | `A50` | 0.5 |
| Arquivo existia, 75-90% mudou | `A75` | 0.75 |
| Arquivo existia, 90%+ mudou | `A90` | 0.9 |
| Arquivo deletado no range | `E` (Exclusão) | 0.4 |

**Default conservador:** se ambíguo, classificar como `I` (deflator 1.0) e marcar `needs_review: true`. Não é nosso papel inflar/deflacionar pra cima.

### 2.7 Itens não mensuráveis (guia local Prodesp)

Detectáveis por sinal específico, contam fora do IFPUG:

| Sigla | Sinal | Peso PF Local |
|---|---|---|
| `PAG` | Página estática (`*.html` em `public/`, ou rota sem fetch) | 0.6 |
| `DCDI` | Migration que insere dados de código (`INSERT INTO ... VALUES`) com 1+ linha | 1.0 |
| `DCFI` | Migration que cria função SQL (`CREATE FUNCTION`) | 1.5 |
| `HARDC` | Constantes de domínio em `src/**/constants.ts` ou enum exposto ao usuário | 0.04 |
| `DATDI` | Setup novo de Elastic/full-text search (`CREATE INDEX ... USING gin`) | 4.9 |

(Lista completa na aba `Deflatores Sisp` das planilhas.)

---

## 3. Arquitetura

```
scripts/apf/
├── estimate.ts              # entrypoint CLI
├── estimate.sh              # wrapper bash
├── inventory/
│   ├── index.ts             # orquestra
│   ├── parse-migrations.ts  # SQL → ALIs
│   ├── parse-edge-fns.ts    # Deno serve → EEs/SEs/AIEs
│   ├── parse-supabase-calls.ts  # AST TS → EE/CE/SE no front
│   ├── parse-rpcs.ts        # cross-ref entre src e migrations
│   └── git-history.ts       # determina manutenção
├── classify/
│   ├── index.ts             # orquestra batch único
│   ├── prompt.ts            # template + few-shot
│   └── client.ts            # Anthropic SDK
├── score/
│   ├── index.ts             # aplica matriz IFPUG + deflator
│   ├── ifpug-tables.ts      # tabelas de complexidade (do reference.md)
│   └── deflators-sisp.ts    # deflatores SISP 2.3
├── report/
│   ├── markdown.ts          # relatório legível
│   └── xlsx.ts              # formato Prodesp (exceljs)
├── mapping.yaml             # DE→PARA editável (sinais + pesos)
└── types.ts                 # InventoryItem, ClassifiedItem, ScoredItem
```

### Fluxo de dados

```ts
// inventory/index.ts produz:
type InventoryItem = {
  id: string;                       // hash estável (path + symbol)
  source_file: string;
  source_line: number;
  candidate_type: 'ALI' | 'AIE' | 'EE' | 'CE' | 'SE' | 'AMBIGUOUS';
  name: string;                     // nome derivado (table name, function name, hook name)
  det: number;                      // contado deterministicamente
  ar_or_rlr: number;                // contado deterministicamente
  ar_details: string[];             // tabelas referenciadas
  det_details: string[];            // colunas/campos contados
  git_status: 'created' | 'modified' | 'deleted' | 'unchanged';
  modification_ratio?: number;      // pra A50/A75/A90
  needs_llm: boolean;               // true só se candidate_type === 'AMBIGUOUS' ou git ambíguo
};

// classify/index.ts produz:
type ClassifiedItem = InventoryItem & {
  type: 'ALI' | 'AIE' | 'EE' | 'CE' | 'SE';   // resolvido
  manutencao: 'I' | 'A' | 'A50' | 'A75' | 'A90' | 'E';
  llm_reasoning?: string;           // só pros que precisaram LLM
};

// score/index.ts produz:
type ScoredItem = ClassifiedItem & {
  complexidade: 'Baixa' | 'Media' | 'Alta';
  pf_ifpug: number;                 // 3, 4, 5, 6, 7, 10, 15
  deflator_sisp: number;
  fator_disciplina: number;         // ex 0.95
  pf_ajustado: number;
};
```

### Cache

- Inventário inteiro hash-eado por `(commit_sha, mapping_yaml_hash)`. Re-rodar no mesmo commit = cache hit, custo zero.
- Classificações LLM cacheadas por `(item_id, item_signature)` em arquivo local `.apf-cache.json`. Reroda só os que mudaram.

---

## 4. Roadmap de execução

### Fase 1 — CLI local (target: ~1 semana)

**Objetivo:** rodar `tsx scripts/apf/estimate.ts --repo /tmp/seplag-ce` e ver um número.

#### 1.1 Inventory (3 dias)
- [ ] `parse-migrations.ts` — usar `pg-query-emscripten` ou `node-sql-parser` pra extrair `CREATE TABLE` + colunas + FKs.
- [ ] `parse-edge-fns.ts` — AST com `@swc/core` pra encontrar `serve()` handlers, métodos HTTP, body parsing.
- [ ] `parse-supabase-calls.ts` — AST TS pra encontrar `supabase.from()`, `.select/insert/update/delete/upsert/rpc`.
- [ ] `git-history.ts` — `git log --follow --numstat` por arquivo, calcular ratio de mudança.
- [ ] **Teste:** rodar no SEPLAG-CE e dump JSON. Inspecionar manualmente: faz sentido?

#### 1.2 Classify (1 dia)
- [ ] `prompt.ts` — template + few-shot extraído das 3 planilhas (~20 exemplos rotulados).
- [ ] Batch único com **todos** os ambíguos (geralmente <30 itens). Cache per-item.
- [ ] **Custo estimado por execução:** ~$0.10-0.30 com Sonnet 4.6.

#### 1.3 Score (0.5 dia)
- [ ] Matriz IFPUG hardcoded de [function-points-reference.md](../features/estimation/function-points-reference.md).
- [ ] Deflatores SISP hardcoded.
- [ ] Fator disciplina = soma de % das fases marcadas (CLI default: todas exceto Implantação = 0.95).

#### 1.4 Report (0.5 dia)
- [ ] Markdown: tabela por tipo, total, breakdown por arquivo.
- [ ] XLSX no formato Prodesp (opcional na Fase 1, obrigatório na Fase 2).

#### 1.5 Smoke test (1 dia)
- [ ] Rodar no SEPLAG-CE inteiro → comparar com gut-feeling do João/time.
- [ ] Rodar no Volund (este repo) → mesma sanidade.
- [ ] Rodar em range de sprint (ex: últimos 7 dias) → simular medição quinzenal.

### Fase 2 — produção no Volund (target: depois da Fase 1 calibrada)

#### 2.1 Backend
- [ ] Mover `scripts/apf/` lib core pra `src/lib/apf/`.
- [ ] Tabela `apf_estimates`: `id, project_id, commit_sha, range_start, range_end, total_pf_ifpug, total_pf_ajustado, breakdown jsonb, generated_by, created_at`.
- [ ] Edge function `apf-estimate`: recebe `{project_id, repo_url, range}`, clona, roda pipeline, persiste, retorna.
- [ ] Cache hit em `(repo_url, commit_sha, mapping_version)` → retorna estimate existente.

#### 2.2 Frontend
- [ ] Página `/admin/apf` — gate `app_metadata.role === 'admin'` na DAL.
- [ ] Form: select project + git ref range.
- [ ] Resultado: tabela detalhada + botão "Export XLSX (formato Prodesp)".
- [ ] Histórico de estimativas por projeto (re-run com `mapping.yaml` versionado fica auditável).

#### 2.3 Calibração contínua
- [ ] Pra cada projeto que tem medição oficial Prodesp, registrar `oficial_pf` na tabela.
- [ ] Dashboard `/admin/apf/calibration`: erro médio % por projeto, drift do `mapping.yaml`.
- [ ] Quando erro > 20%, abrir issue de ajuste de heurística.

---

## 5. Calibração sem ground-truth

Como **não temos** repos+commits das planilhas Riple/PGF/Escalas pra comparar, vamos calibrar empiricamente:

### 5.1 Sanity-check inicial (Fase 1)
1. Rodar no SEPLAG-CE inteiro (projeto novo, 41 migrations, ~10 páginas) → esperamos algo entre **150-300 PF** baseado em projetos similares (ver `function-points-reference.md` §6 — CRM com escopo parecido = 198 PF).
2. Rodar no Volund inteiro → mesma faixa, comparar com gut-feeling.
3. Se sair fora dessa faixa por mais de 2x, há bug no inventory ou classifier — não no edital.

### 5.2 Calibração com projeto-piloto (Fase 2)
1. Escolher 1 projeto novo onde **decidimos antecipadamente** rodar o estimator + medição oficial em paralelo.
2. Após 2-3 medições oficiais, comparar deltas.
3. Ajustar `mapping.yaml`:
   - Se subestimando: provavelmente perdendo SE (dashboards) ou PAG/HARDC (itens locais).
   - Se superestimando: provavelmente double-counting (mesma query em vários componentes).

### 5.3 Métricas de saúde
- **Recall de funções:** das funções que o métrico humano listou, quantas o estimator achou? (Meta: >85%)
- **Precisão:** das funções que o estimator achou, quantas são funções de fato? (Meta: >80%)
- **Erro de PF total:** |estimado - oficial| / oficial. (Meta: <20% após 3 calibrações.)

---

## 6. Decisões abertas (precisam input do João)

| # | Decisão | Default proposto |
|---|---|---|
| 1 | Onde guardar o `mapping.yaml` em produção — repo do estimator ou tabela DB editável por admin? | Repo + versionado em git, edição via PR |
| 2 | Range default da estimativa: branch inteira vs último N dias vs sprint atual | CLI: range explícito; UI: select de sprint |
| 3 | Tratar deps externas (Supabase auth, Stripe SDK) como AIE? | Não — só APIs de domínio do produto |
| 4 | Componentes shadcn/ui copy-pasted contam como reuso? | Não contam — são UI primitives, não funções |
| 5 | Quando o repo tem testes (`*.test.ts`), incluir em PFT (peso 0.15)? | Não na v1 — só código de produção |
| 6 | Migrações de dados (seeds, INSERTs em massa) → PMD (peso 1.0)? | Sim, se INSERT >10 linhas em migration |

---

## 7. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| LLM classifica errado em escala | Erro de PF >30% | `temperature: 0` + few-shot + cap de uso (só ambíguos) |
| Inventory perde funções escondidas em hooks customizados | Subestima | Heurística "todo `useQuery` é candidata", LLM filtra falsos positivos |
| `mapping.yaml` diverge entre projetos | Estimates incomparáveis | Versionar mapping; report exibe versão usada |
| Repo gigante = custo LLM alto | Caro | Cache agressivo + `temperature: 0` + classificação só dos ambíguos |
| Métrico humano discorda da classificação | Estimate "errada" oficialmente | Aceitar — meta é precificação interna, não medição oficial |
| Mudanças no edital SISP futuras | Quebra deflators | YAML versionado, fácil bump |

---

## 8. Custo estimado por execução (Fase 1)

Para um repo do tamanho do SEPLAG-CE (41 migrations, ~10 páginas, ~30 hooks):

| Etapa | Tempo | Custo |
|---|---|---|
| Inventory (AST/regex) | ~5s | $0 |
| Classify (Sonnet, ~30 itens ambíguos, prompt com few-shot ~3k tokens) | ~15s | ~$0.05 |
| Score + Report | ~1s | $0 |
| **Total** | **~20s** | **~$0.05** |

Re-execução no mesmo commit (cache hit) = $0.

---

## 9. Sucesso

Fase 1 considera-se concluída quando:
- [ ] `tsx scripts/apf/estimate.ts --repo /tmp/seplag-ce` produz relatório markdown sem erro.
- [ ] Total PF do SEPLAG-CE cai na faixa 150-300 PF.
- [ ] Re-execução com cache é instantânea.
- [ ] Output inclui breakdown por tipo (ALI/AIE/EE/SE/CE) com lista de funções.
- [ ] `mapping.yaml` é editável e mudança recalcula sem rebuild.

Fase 2 considera-se concluída quando:
- [ ] Admin loga em `/admin/apf`, escolhe projeto e range, vê estimativa em <30s.
- [ ] Estimativa fica persistida e re-calculável.
- [ ] Export XLSX abre no Excel/LibreOffice no formato Prodesp.
- [ ] Pelo menos 1 projeto-piloto rodou em paralelo com medição oficial pra calibração.
