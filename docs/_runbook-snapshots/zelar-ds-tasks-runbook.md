# Runbook 2.0 — Geração de Tasks Técnicas (Zelar / Inception)

**DS:** `e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f` (Inception Zelar)
**Project:** Zelar (`ZLAR`) — `e41c492e-7a14-44b2-83b9-b8e0f2b38e4c`
**Modo:** Claude Code executando como Vitor (regras de [src/lib/agent/prompt.ts](../../src/lib/agent/prompt.ts) sub-fase `task_breakdown`).
**Materialização:** SQL versionado em `supabase/migrations/`. Aplicação fica a critério do time.

---

## 0 · Filosofia (leia 1× e siga)

**Estado vivo mora no banco. Runbook é manual fino.**

Após `/clear` ou `/compact`, releia **só este arquivo** + rode **1 query**:

```sql
SELECT * FROM runbook.session_state
WHERE session_id = 'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f';
```

Tudo que importa pra continuar (counters, last task ref, sinais de qualidade) está nessa view.

**3 fontes da verdade:**

| Fonte | O que tem | Como ler |
|---|---|---|
| `public."DesignSessionBrainstormFeature"` | 72 features do brainstorm da DS Zelar (espelho relacional do jsonb) | `SELECT ... WHERE "sessionId" = '<DS>'` |
| `public."UserStory"` + `public."Task"` | Stories aprovadas + tasks geradas | Tabelas do produto |
| `runbook.*` | Auditoria: anchor task→brainstorm, story coverage, funções | Schema isolado, descartável |

---

## 1 · Identidades

```sql
-- Constants (cole no início de cada migration)
v_session_id uuid := 'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f';
v_project_id uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';
```

**Módulos (12, todos `proposed:` exceto `LOGIN`):**
`ADMIN_OPERACAO`, `ANTI_BYPASS_ENGINE`, `AUTENTICACAO_ONBOARDING`, `CATALOGO_SOLICITACAO`, `COMUNICACAO_NOTIFICACOES`, `CONCLUSAO_FINANCEIRO`, `EXECUCAO_DO_SERVICO`, `LOGIN`, `MATCHING_ALOCACAO`, `ONBOARDING_DO_PRESTADOR`, `PERFIL_CONFIGURACOES`, `SUPORTE_CONFIANCA`.

---

## 2 · Comandos canônicos

### 2.1 — "Onde paramos?"

```sql
SELECT * FROM runbook.session_state
WHERE session_id = 'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f';
```

Retorna em 1 linha: total stories, total tasks, features ativas, **tasks sem anchor** (= invenções minhas), **features sem task** (= cobertura faltando), stories cobertas por outras, last task ref.

### 2.2 — Auditoria de invenções

```sql
-- Quais tasks foram criadas sem ligação ao brainstorm?
-- Resultado deve ser sempre vazio quando o método 2.0 está sendo aplicado.
SELECT * FROM runbook.tasks_without_brainstorm_anchor(
  'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f'
);
```

### 2.3 — Auditoria de cobertura

```sql
-- Quais features do brainstorm (não-archived, MVP) ainda não viraram task?
SELECT module_hint, title, feature_id
FROM runbook.unmapped_brainstorm_features(
  'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f'
)
ORDER BY module_hint NULLS LAST;
```

### 2.4 — Mapa de cobertura por story

```sql
SELECT story_ref, ac_count, task_count, total_fp, covered_marker
FROM runbook.story_coverage_report(
  'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f'
)
WHERE module_name = '<MODULO>'  -- filtra por módulo
ORDER BY story_ref;
```

### 2.5 — Brainstorm filtrado por módulo

```sql
-- Lê só as features que importam pra um módulo específico (~5KB de tokens)
SELECT id, title, "howItSolves", "technicalNotes", bucket
FROM "DesignSessionBrainstormFeature"
WHERE "sessionId" = 'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f'
  AND NOT archived
  AND "moduleHint" = '<HINT>'  -- LOGIN, CADASTRO, etc
ORDER BY "orderIndex";
```

> Hints comuns na DS Zelar: `ADMIN`, `BACKOFFICE`, `CADASTRO`, `CONTA`, `FINANCEIRO`, `GROWTH`, `HOME`, `LGPD`, `LOGIN`, `NOTIFICAÇÃO`, `ONBOARDING`, `OPERAÇÃO`, `PERFIL`, `PRODUTO`, `SERVIÇO`, `SISTEMA`, `SOLICITAÇÃO`, `SUPORTE`. **Atenção:** hint ≠ `Module.name`. Hint vem do prefixo `[X]` do título do card; `Module.name` é o nome canônico do módulo (`AUTENTICACAO_ONBOARDING`, etc).

### 2.6 — Stories de um módulo + AC

```sql
SELECT s.reference, s.title, p.name AS persona, s."refinementStatus",
       (SELECT count(*) FROM "Task" t WHERE t."userStoryId" = s.id) AS task_count,
       (SELECT count(*) FROM "AcceptanceCriterion" ac WHERE ac."userStoryId" = s.id) AS ac_count
FROM "UserStory" s
LEFT JOIN "ProjectPersona" p ON s."personaId" = p.id
WHERE s."designSessionId" = 'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f'
  AND s."moduleId" = (SELECT id FROM "Module" WHERE name = '<MODULO>'
                                                AND "projectId" = 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c')
ORDER BY s.reference;
```

### 2.7 — AC produto de uma story

```sql
SELECT ac."order", ac.text
FROM "UserStory" s
JOIN "AcceptanceCriterion" ac ON ac."userStoryId" = s.id
WHERE s.reference = '<STORY_REF>'
ORDER BY ac."order";
```

---

## 3 · Padrão de task (regras Vitor sintetizadas)

### 3.1 — Naming

`<verbo no infinitivo> <objeto concreto> <qualificador opcional com/via/para>`. 6–12 palavras.

**Verbos:** Criar, Renderizar, Persistir, Validar, Migrar, Conectar, Expor, Sincronizar, Substituir, Indexar, Cachear, Autorizar, Autenticar, Disparar, Agendar.

**Proibido:** prefixo de camada (`Frontend:`, `Backend:`), tags soltas com `+`, substantivos genéricos (`tela de Perfil`), verbos vagos (`Implementar`, `Fazer`).

**Auto-teste:** "Lendo só o título, alguém consegue dizer o que fica diferente no produto?"

### 3.2 — Description (markdown denso)

```
## Objetivo
[1-2 frases concretas: o que entrega + por que importa]

## Contexto
[Como se encaixa no fluxo / módulo / persona / dependência semântica]

## Estado atual / O que substitui
[Refator: arquivo + comportamento atual; criação: como sobrevive hoje sem isso]

## O que criar
[Caminhos sugeridos, pseudocódigo, schema, JSX. Seja CONCRETO.]

## Constraints / NÃO fazer
- ...

## Convenções
[Tokens design system, padrões a seguir]
```

NÃO inclua AC dentro de `description` — vai no campo `acceptanceCriteria` array.

### 3.3 — `acceptanceCriteria` (array)

Cada item **verificável em PR** (sim/não), uma frase. Inclui:
- Pelo menos 1 regression check ("X continua funcionando após mudança")
- Lint/typecheck quando aplicável
- **NUNCA duplica AC produto da Story** (essas são observáveis pelo usuário; AC técnico exige ler PR)

### 3.4 — `notes`

```
**Habilita:** [prosa do que vira viável]
**Risco:** [baixo/medio/alto + razão]
**Estratégia de validação:** [QA manual quando relevante]
**Ref:** [spec, mapa, fonte de verdade]
**Tempo estimado:** [Xh-Yh]
```

NÃO duplique `dependsOn` aqui (refs estruturadas vão no campo).

### 3.5 — `complexity` × `scope` → FP

| | trivial | low | medium | high |
|---|---:|---:|---:|---:|
| **micro** | 3 | 4 | 5 | 7 |
| **small** | 4 | 5 | 7 | 10 |
| **medium** | 5 | 7 | 10 | 15 |
| **large** | 7 | 10 | 15 | 21 |

**Regra:** se task > 15 FP, considera quebrar em 2.

### 3.6 — `dependsOn`

Refs textuais `ZLAR-T-NNN`, kind `blocks` (default).

---

## 4 · Workflow de uma story

```
┌─ 1. AUDITORIA (3 queries SQL)
│  - 2.5: brainstorm features do módulo
│  - 2.6: stories irmãs do módulo (ver tasks já criadas)
│  - 2.7: AC produto da story alvo
│
├─ 2. CLASSIFICAÇÃO
│  - ≥80% AC sobreposto + persona igual → DUPLICATA (mark_story_covered_by)
│  - 30-80% sobreposto → COMPLEMENTAR (criar só delta)
│  - <30% → NOVA (mapeamento 1:1 AC → tasks)
│
├─ 3. MAPEAMENTO
│  - Tabela: AC produto → slice técnica → task title
│  - Identificar setup compartilhado (DB schema, helper) reusável por outras stories
│  - Ordenar topologicamente: DB/RLS → Helper → Front/UI → Realtime/Edge
│
├─ 4. MATERIALIZAÇÃO (migration `supabase/migrations/<YYYYMMDD>_seed_tasks_<modulo>_<usNN>.sql`)
│  - Helpers temporários: pg_temp.fp(), pg_temp.upsert_task(), pg_temp.add_dep()
│  - Cada upsert_task captura ref, usa em add_dep das próximas
│  - Anchor obrigatório:
│      runbook.attach_task_anchor(
│        p_task_ref => 'ZLAR-T-NNN',
│        p_brainstorm_feature => '<feature_id>' OR NULL,
│        p_brainstorm_session => 'e4c2b0e5-...' OR NULL,
│        p_covers_ac => ARRAY[0,1,2],
│        p_source => 'from_brainstorm' | 'gap_fill' | 'infra_setup',
│        p_gap_reason => 'razão se não from_brainstorm'
│      )
│
├─ 5. APPLY (psql ou tool do time)
│
└─ 6. VALIDAÇÃO
   - SELECT * FROM runbook.session_state WHERE session_id = '<DS>';
     → tasks_without_anchor deve continuar 0
   - Reportar: refs criadas, FP total, AC count, deps, próxima story sugerida
```

### 4.1 — Helpers SQL canônicos

Implementação completa em [supabase/migrations/20260508_seed_tasks_auth_onboarding.sql](../../supabase/migrations/20260508_seed_tasks_auth_onboarding.sql). Esqueleto:

```sql
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.fp(p_scope text, p_complexity text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$ /* matriz */ $$;

CREATE OR REPLACE FUNCTION pg_temp.upsert_task(...)
RETURNS text LANGUAGE plpgsql AS $$ /* lookup por (session,story,title,draft) → INSERT ou UPDATE */ $$;

CREATE OR REPLACE FUNCTION pg_temp.add_dep(...)
RETURNS void LANGUAGE plpgsql AS $$ /* INSERT em TaskDependency by ref */ $$;

DO $seed$
DECLARE
  v_session_id uuid := 'e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f';
  v_project_id uuid := 'e41c492e-7a14-44b2-83b9-b8e0f2b38e4c';
  v_story uuid := '<UUID da story>';
  r_a text; r_b text; ...
BEGIN
  r_a := pg_temp.upsert_task(v_session_id, v_project_id, v_story, '<title>', $d$<desc>$d$, '<complexity>', '<scope>', $n$<notes>$n$, ARRAY[...]);
  PERFORM runbook.attach_task_anchor(r_a, '<feature_id>', v_session_id, ARRAY[0,1], 'from_brainstorm');

  r_b := pg_temp.upsert_task(...);
  PERFORM pg_temp.add_dep(r_b, r_a, 'blocks');
  PERFORM runbook.attach_task_anchor(r_b, '<feature_id>', v_session_id, ARRAY[2], 'from_brainstorm');
END $seed$;

COMMIT;
```

---

## 5 · Estado atual (queryable, não duplicar aqui)

```sql
SELECT * FROM runbook.session_state WHERE session_id = '<DS>';
SELECT * FROM runbook.story_coverage_report('<DS>');
```

**Snapshot 2026-05-09:** 47 tasks (T-001..T-047), 0 sem anchor, 65 features ativas, 54 sem task, 4 stories cobertas (US-007, US-057, US-058, US-071).

**Cobertura por módulo (alta-leitura, regenerável):**

```sql
SELECT module_name,
       count(*) FILTER (WHERE task_count > 0) AS stories_with_tasks,
       count(*) AS total_stories,
       sum(total_fp) AS total_fp
FROM runbook.story_coverage_report('e4c2b0e5-23f1-4b08-b8d8-fa81be818d4f')
GROUP BY module_name
ORDER BY module_name;
```

---

## 6 · Próximos passos (ordem sugerida)

Foi reaproveitado o roadmap, mas agora cada módulo começa com:

```sql
-- "Quais features deste módulo ainda não têm task?"
SELECT * FROM runbook.unmapped_brainstorm_features('<DS>')
WHERE module_hint = '<HINT_DO_MODULO>';
```

Ordem por dependência (do mais auto-suficiente pro mais acoplado):

1. **`ONBOARDING_DO_PRESTADOR`** — reaproveita T-041 (`provider_profiles`). Stories: KYC submission, conta bancária, consents.
2. **`PERFIL_CONFIGURACOES`** — reaproveita `client_profile` (T-035) e `provider_profiles` (T-041).
3. **`CATALOGO_SOLICITACAO`** — `service_requests`, motor de precificação, pagamento Mercado Pago.
4. **`COMUNICACAO_NOTIFICACOES`** — templates WhatsApp catalog completo + Resend + Web Push.
5. **`MATCHING_ALOCACAO`** — score multivariado, pool broadcast, fairness.
6. **`EXECUCAO_DO_SERVICO`** — stepper cliente/prestador, GPS heartbeat, abandono.
7. **`CONCLUSAO_FINANCEIRO`** — assinatura digital, escrow pg_cron, carteira.
8. **`SUPORTE_CONFIANCA`** — disputas, RLS matrix, anti-bypass entry-points.
9. **`ANTI_BYPASS_ENGINE`** — score R(o,c), escalonamento N1→N4.
10. **`ADMIN_OPERACAO`** restante (US-067..US-098).
11. **`AUTENTICACAO_ONBOARDING`** restante — completar lacunas que apareceram na auditoria (ex: logout universal).
12. **`LOGIN`** restante — US-082 (admin), US-070 cooldown delta.

---

## 7 · Comandos para usuário

| Você diz | Eu faço |
|---|---|
| "prosseguir story `<REF>`" | Workflow seção 4 inteiro pra essa story |
| "auditar módulo `<NOME>`" | Roda 2.5 + 2.6 + agrupa, propõe ordem de stories |
| "estado" ou "onde paramos" | `SELECT * FROM runbook.session_state` + sumário |
| "features sem task" | Roda 2.3 e mostra agrupado por módulo |
| "tasks da story `<REF>`" | Lista refs/title/FP/AC count |
| "cobrir lacuna `<feature_id>` na story `<REF>` como gap_fill" | Cria 1 task + anchor com source=gap_fill |

---

## 8 · Histórico de execução (resumo, fonte real é o banco)

### Módulo 1 — `AUTENTICACAO_ONBOARDING` (lote inicial, pré-método 2.0)
- US-002, US-003, US-004, US-005, US-006 → T-030..T-040 (11 tasks).
- Migration: [20260508_seed_tasks_auth_onboarding.sql](../../supabase/migrations/20260508_seed_tasks_auth_onboarding.sql).
- **Lição:** T-036 (large/21 FP) ficou granular demais. Próximas stories análogas devem subdividir.
- **Anchor retroativo aplicado:** todas com source assinado.

### Módulo 2 — `LOGIN` (parcial)
- US-081 → T-041..T-047 (7 tasks).
- Migration: [20260508_seed_tasks_login_us081.sql](../../supabase/migrations/20260508_seed_tasks_login_us081.sql).
- 4 stories marcadas cobertas (`runbook.story_coverage`): US-007, US-057, US-058, US-071.
- **Pendente no módulo:** US-082 (admin login), US-070 delta (magic link cooldown).

### Infra do método 2.0
- `DesignSessionBrainstormFeature` + triggers de sync — [20260508_brainstorm_feature_table.sql](../../supabase/migrations/20260508_brainstorm_feature_table.sql).
- Schema `runbook.*` (anchor, coverage, funções, view) — [20260508_runbook_schema.sql](../../supabase/migrations/20260508_runbook_schema.sql).
- Anchor backfill das 47 tasks pré-método — [20260508_runbook_anchor_backfill.sql](../../supabase/migrations/20260508_runbook_anchor_backfill.sql).
