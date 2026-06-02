# PRD — SIAL Núcleo de Processo (Core)

**Reference**: SIAL-CORE
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (React + Supabase + GCP) — repo do cliente, não Volund
**Depende de**: — (é a fundação; tudo depende deste)

## Grounding

> Legenda (espelha os insumos): `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: núcleo de Processo genérico (modelagem §2), status como enums/máquinas de estado (modelagem §4), `evento`/rastreabilidade com triggers (modelagem §8), modelo híbrido JSONB+GIN (modelagem §5), Protocolo/Método (modelagem §3; doc §2).
- **[decisão-sessão]**: PostgreSQL via Supabase, RLS habilitado por padrão.
- **[inferência]**: nomes de coluna, assinatura de `sial_transicao()`, trigger específico, formato do `numero` de protocolo, paths de API, recorte das stories. Schema concreto = proposta a validar com a JUCESP.

## Demo/Mock (one-shot)

> Núcleo **não tem gateway externo** — roda puro em Supabase (`prd-sial-app-shell`). Na demo, `usuarioId` das transições vem do dev-auth (troca de persona). Smoke 100% automatizável por `scripts/smoke/core-process.ts` (`npm run smoke core-process`): cria processo, transiciona e confere os eventos via SQL.

## §1 Problema

1. A JUCESP opera hoje processos de livros, leiloeiros, tradutores e denúncias de forma **manual e fragmentada**, sem máquina de estados nem registro de quem fez o quê (doc §1, §3.3).
2. **Requerimento e Denúncia compartilham quase toda a mecânica** — análise, decisão, tramitação, assinatura e documentos são iguais; construir dois sistemas paralelos duplicaria código e bug (modelagem §2).
3. Sem um núcleo comum, **cada novo fluxo futuro da JUCESP** exigiria reconstruir análise/tramitação do zero.
4. **Rastreabilidade é pilar do projeto** (autenticidade, rastreabilidade, segurança), mas se a tabela de eventos não nascer com o sistema, vira "log adicionado depois" e perde transições (modelagem §8).

## §2 Solução em uma frase

Estabelece o núcleo de dados e o motor de **Processo genérico** (Processo, Protocolo, Método, máquinas de estado e tabela de Eventos com trigger) sobre o qual Requerimento, Denúncia e qualquer fluxo futuro se especializam.

## §3 Não-objetivos

- UI dos fluxos de negócio (cada superfície tem seu PRD).
- Os subtipos concretos Requerimento/Denúncia/Livro — aqui só o **supertipo Processo** e os enums de estado.
- Integrações externas (SEFAZ, Receita, SOAP, E2DOC) — PRDs próprios.
- Auth de usuário e RLS por perfil — vêm em `prd-sial-identity-access`. Aqui o RLS **nasce habilitado (default deny)** e as policies finas entram depois.
- CRUD de Método (criar/editar schema de formulário) — vem em `prd-sial-parametrizacao`. Aqui só leitura do método pelo motor.

## §4 Personas e jornada

- **Builder SIAL**: "Quero um núcleo de Processo que eu **estenda**, não reescreva, a cada fluxo novo."
- **Resolvedor (indireto)**: "Quero que toda ação no protocolo fique registrada e rastreável."
- **Auditor JUCESP**: "Preciso provar o histórico de transições de cada protocolo, sem depender de log da aplicação."

## §5 Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | Supertipo `Processo` + discriminador `tipo` (`requerimento`/`denuncia`); subtipos ganham tabela própria em PRDs futuros | Modelagem §2: núcleo único, especializações por cima. Evita duas árvores paralelas. |
| D2 | Modelo híbrido: colunas reais para o estável; `Processo.dados` JSONB + índice GIN para o parametrizável por método | Modelagem §5. EAV vira pesadelo de query; JSONB indexa bem no Postgres/Supabase. |
| D3 | Status como **enum Postgres** (`sial_processo_status`), superset de requerimento+denúncia | Modelagem §4: estados controlados, não strings livres. |
| D4 | Transições centralizadas: função SQL `sial_transicao()` **e** módulo TS `state-machine.ts` (defesa em profundidade) | Nunca espalhar `UPDATE status` pelo código. Toda mudança passa pela máquina que valida origem→destino. |
| D5 | Trigger `AFTER UPDATE` em `Processo` grava `Evento` automaticamente em toda mudança de status | Modelagem §8: garante rastreabilidade sem depender de a aplicação lembrar. |
| D6 | `Protocolo` separado de `Processo` (1-1); `numero` visível ao usuário. Código público não-adivinhável fica em `Autenticacao` (outro PRD) | O número de protocolo é de uso operacional; o segredo de validação pública é outro conceito (modelagem §7). |
| D7 | `Processo.requerenteId` e `Evento.usuarioId` nascem `uuid` **sem FK**; FK + RLS por perfil entram em `prd-sial-identity-access` via ALTER | Mantém migrations atômicas e o core sobe antes de identity. |
| D8 | RLS **habilitado em todas as tabelas** já na criação; baseline nega tudo (só service role server-side), policies finas em PRD2 | Segurança por padrão; o RF09/LGPD não pode ser retrofit. |
| D9 | IDs `uuid` via `gen_random_uuid()` | Padrão Supabase; não-sequencial. |
| D10 | `Metodo` criado aqui (tabela + leitura), mas editor de schema fica em `prd-sial-parametrizacao` | O motor precisa ler método para renderizar; criar/editar é capacidade de admin. |

## §6 Arquitetura

```
                         ┌─────────────────────────────┐
   POST /api/processos   │         API (Next/React)     │
   ───────────────────►  │  cria Processo (rascunho)    │
                         │                              │
   POST .../transition   │  chama sial_transicao()      │
   ───────────────────►  │  via DAL + state-machine.ts  │
                         └──────────────┬───────────────┘
                                        │ (server, service role)
                                        ▼
   ┌────────────────────────── Supabase (PostgreSQL) ──────────────────────────┐
   │                                                                            │
   │   Metodo ──1:N──► Processo ──1:1──► Protocolo (numero visível)             │
   │   (schema JSONB)     │  status:sial_processo_status                        │
   │                      │  dados:jsonb (GIN)                                  │
   │                      │                                                     │
   │                      │  AFTER UPDATE OF status  ──trigger──►  Evento       │
   │                      └──1:N──────────────────────────────►  (append-only) │
   │                                                                            │
   │   sial_transicao(processoId, novoStatus, usuarioId, payload)               │
   │     └─ valida origem→destino (tabela de transições) → UPDATE → trigger     │
   └────────────────────────────────────────────────────────────────────────┘

   Toda mudança de status ⇒ 1 linha em Evento (statusAnterior, statusNovo, usuario, payload).
```

## §7 Schema

> Migrations **atômicas**, uma por arquivo, rodadas via `psql "$DIRECT_URL" -f ...`. Ordem abaixo.

```sql
-- 1) <data>_sial_enums.sql
CREATE TYPE sial_processo_tipo AS ENUM ('requerimento','denuncia');

CREATE TYPE sial_processo_status AS ENUM (
  -- requerimento
  'rascunho','aguardando_pagamento','enviado_analise','em_analise',
  'em_exigencia','deferido','tramitado','arquivado',
  -- denúncia
  'pendente','despachada','proresp'
);
```

```sql
-- 2) <data>_sial_metodo.sql
CREATE TABLE "Metodo" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  dominio text NOT NULL CHECK (dominio IN ('livro','leiloeiro','tradutor')),
  "schemaFormulario" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ativo boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "Metodo" ENABLE ROW LEVEL SECURITY;
```

```sql
-- 3) <data>_sial_processo.sql
CREATE TABLE "Processo" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo sial_processo_tipo NOT NULL,
  "metodoId" uuid REFERENCES "Metodo"(id),          -- null para denúncia
  "requerenteId" uuid,                              -- FK p/ Usuario adicionada em SIAL-IAM
  status sial_processo_status NOT NULL DEFAULT 'rascunho',
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "Processo_status_idx" ON "Processo" (status);
CREATE INDEX "Processo_tipo_idx" ON "Processo" (tipo);
CREATE INDEX "Processo_dados_gin" ON "Processo" USING gin (dados);
ALTER TABLE "Processo" ENABLE ROW LEVEL SECURITY;
```

```sql
-- 4) <data>_sial_protocolo.sql
CREATE TABLE "Protocolo" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "processoId" uuid NOT NULL UNIQUE REFERENCES "Processo"(id) ON DELETE CASCADE,
  numero text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "Protocolo_numero_idx" ON "Protocolo" (numero);
ALTER TABLE "Protocolo" ENABLE ROW LEVEL SECURITY;
```

```sql
-- 5) <data>_sial_evento.sql
CREATE TABLE "Evento" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "processoId" uuid NOT NULL REFERENCES "Processo"(id) ON DELETE CASCADE,
  "usuarioId" uuid,                                 -- FK p/ Usuario adicionada em SIAL-IAM
  "tipoEvento" text NOT NULL,
  "statusAnterior" sial_processo_status,
  "statusNovo" sial_processo_status,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "Evento_processo_idx" ON "Evento" ("processoId","createdAt");
ALTER TABLE "Evento" ENABLE ROW LEVEL SECURITY;
```

```sql
-- 6) <data>_sial_evento_trigger.sql
CREATE OR REPLACE FUNCTION sial_log_status_change() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO "Evento" ("processoId","tipoEvento","statusAnterior","statusNovo","usuarioId",payload)
    VALUES (NEW.id, 'status_change', OLD.status, NEW.status,
            current_setting('sial.usuario_id', true)::uuid,
            jsonb_build_object('via','trigger'));
  END IF;
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sial_processo_status
  AFTER UPDATE OF status ON "Processo"
  FOR EACH ROW EXECUTE FUNCTION sial_log_status_change();
```

```sql
-- 7) <data>_sial_transicao_fn.sql  (state machine no banco)
CREATE OR REPLACE FUNCTION sial_transicao(
  p_processo uuid, p_novo sial_processo_status, p_usuario uuid, p_payload jsonb DEFAULT '{}'
) RETURNS "Processo" AS $$
DECLARE r "Processo";
BEGIN
  PERFORM set_config('sial.usuario_id', coalesce(p_usuario::text,''), true);
  -- valida transição permitida (tabela de transições versionada na app; aqui o guard mínimo)
  UPDATE "Processo" SET status = p_novo WHERE id = p_processo RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'processo % nao encontrado', p_processo; END IF;
  RETURN r;
END;
$$ LANGUAGE plpgsql;
```

> RLS: nesta fase as tabelas têm RLS **on** sem policy permissiva → acesso só via service role (server-side). `prd-sial-identity-access` adiciona as policies por perfil e as FKs de `requerenteId`/`usuarioId`.

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| POST | `/api/processos` | Body `{tipo, metodoId?, requerenteId?, dados?}` → cria `Processo` (status=rascunho) + `Protocolo` (numero gerado) → 201 `{processo, protocolo}` |
| GET | `/api/processos/:id` | → `{processo, protocolo, status}` |
| POST | `/api/processos/:id/transition` | Body `{novoStatus, usuarioId, payload?}` → valida via state-machine → chama `sial_transicao` → 200 `{processo}`; 409 se transição inválida |
| GET | `/api/processos/:id/eventos` | → `{eventos: []}` ordenado por `createdAt` (timeline) |
| GET | `/api/metodos?ativo=true` | → `{metodos: []}` para o motor renderizar formulário |

## §9 UX

Núcleo é backbone — a única UI é o **componente reutilizável de timeline de eventos**, consumido por todos os PRDs de superfície (status do requerente, histórico do analista, auditoria).

```
┌──────────────── Histórico do protocolo 2026-000123 ───────────────┐
│ ● 12/05 09:14  Criado (rascunho)              — requerente         │
│ ● 12/05 09:40  Pagamento confirmado           — sistema           │
│ ● 12/05 10:02  Enviado para análise           — requerente        │
│ ● 13/05 14:20  Em análise                     — Maria (resolvedor)│
│ ● 13/05 16:05  Exigência aberta               — Maria (resolvedor)│
└────────────────────────────────────────────────────────────────────┘
```

## §10 Integrações

- **Todos os PRDs de superfície** (requerimento, análise, denúncia, documentos) criam suas tabelas com FK para `Processo` e disparam transições via `/transition`.
- **`prd-sial-identity-access`**: adiciona FKs `requerenteId`/`usuarioId` e policies RLS.
- **`prd-sial-parametrizacao`**: popula `Metodo.schemaFormulario`.
- **`prd-sial-dashboards-relatorios`**: lê `Evento` para SLA/tempo médio por etapa.

## §11 Faseamento

Fase 1 (esta PRD): schema (enums + 4 tabelas) → trigger de evento → `sial_transicao` → state-machine TS → API (5 endpoints) → componente de timeline → smoke. Entrega o backbone do qual nenhum fluxo atual existe — portanto ≥ sistema atual por definição.

Fase 2+: nada nesta PRD; os fluxos vêm nos PRDs de superfície.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Enum de status engessar evolução (novo estado exige migration) | M | B | Estados são poucos e estáveis; ALTER TYPE ADD VALUE é barato. Tabela de transições versionada na app absorve regras. |
| Trigger de evento degradar performance em alta carga | B | M | Insert simples, índice em (processoId, createdAt); evento é append-only sem leitura no caminho quente. |
| `UPDATE status` direto burlando a state machine | M | A | `sial_transicao` é o único caminho documentado; revisão de código + guard na app. Trigger ainda registra qualquer mudança. |
| RLS habilitado sem policy quebra leitura antes da PRD2 | A | B | Esperado: acesso só via service role server-side nesta fase; documentado em D8. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Todo processo tem ≥1 evento por transição | `SELECT count(*) FROM "Processo" p WHERE NOT EXISTS (SELECT 1 FROM "Evento" e WHERE e."processoId"=p.id)` → 0 para processos que já transicionaram |
| Distribuição de processos por status | `SELECT status, count(*) FROM "Processo" GROUP BY status` |
| Transições inválidas barradas | contador de 409 em `/transition` (log) |

## §14 Open questions

- ❓ (gap G8) Dados variáveis por método justificam JSONB total, ou colunas reais bastam? **Decisão atual: híbrido (D2); revisитar em parametrização se métodos forem poucos/estáveis.** Não bloqueia esta PRD.
- ❓ (gap G11) Tramitação tem limite de passos? Afeta a state machine de `tramitado`. **Resolução: PRD `prd-sial-tramitacao`.**

## §15 Referências

- Insumos: `Modelagem_de_Dados_SIAL.md` §2,§4,§5,§8; `Documento_de_Produto_SIAL.md` §6A.6.
- DesignSession `b0a0f115-0ba3-48e6-92c2-244fe115855b` — brainstorm card "Motor de Requerimento unificado" + "Rastreabilidade / Audit log".
- Memory: AGENTS.md (Supabase via psql; migrations atômicas).

## §16 Stories implementáveis

```yaml
- id: SIAL-CORE-001
  title: Migration — enums sial_processo_tipo + sial_processo_status
  description: Cria os dois tipos enum conforme §7 (1). Arquivo único.
  acceptanceCriteria:
    - "Migration <data>_sial_enums.sql aplica sem erro via psql"
    - "sial_processo_status tem os 11 valores do superset"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='sial_processo_status'"
      expected: "11"
  dependsOn: []
  estimateMinutes: 15
  touches: ["supabase/migrations/"]

- id: SIAL-CORE-002
  title: Migration — tabela Metodo (+ RLS on)
  description: Cria Metodo conforme §7 (2) com CHECK de dominio e RLS habilitado.
  acceptanceCriteria:
    - "Tabela Metodo existe com coluna schemaFormulario jsonb"
    - "RLS habilitado em Metodo"
  verifiable:
    - kind: sql
      command_or_query: "SELECT relrowsecurity FROM pg_class WHERE relname='Metodo'"
      expected: "t"
  dependsOn: [SIAL-CORE-001]
  estimateMinutes: 15
  touches: ["supabase/migrations/"]

- id: SIAL-CORE-003
  title: Migration — tabela Processo (+ GIN + RLS on)
  description: Cria Processo conforme §7 (3) com índices status/tipo/GIN(dados) e RLS on. requerenteId sem FK (D7).
  acceptanceCriteria:
    - "Processo existe com status sial_processo_status default rascunho"
    - "Índice GIN em dados existe"
    - "RLS habilitado"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_indexes WHERE tablename='Processo' AND indexname='Processo_dados_gin'"
      expected: "1"
  dependsOn: [SIAL-CORE-001, SIAL-CORE-002]
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-CORE-004
  title: Migration — tabela Protocolo (1:1 Processo, numero unique)
  description: Cria Protocolo conforme §7 (4).
  acceptanceCriteria:
    - "Protocolo.processoId é UNIQUE e FK p/ Processo ON DELETE CASCADE"
    - "Protocolo.numero é UNIQUE"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.table_constraints WHERE table_name='Protocolo' AND constraint_type='UNIQUE'"
      expected: "2"
  dependsOn: [SIAL-CORE-003]
  estimateMinutes: 15
  touches: ["supabase/migrations/"]

- id: SIAL-CORE-005
  title: Migration — tabela Evento (append-only + RLS on)
  description: Cria Evento conforme §7 (5) com índice (processoId, createdAt). usuarioId sem FK (D7).
  acceptanceCriteria:
    - "Evento existe com statusAnterior/statusNovo sial_processo_status"
    - "Índice Evento_processo_idx existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.columns WHERE table_name='Evento' AND column_name='statusNovo'"
      expected: "1"
  dependsOn: [SIAL-CORE-003]
  estimateMinutes: 15
  touches: ["supabase/migrations/"]

- id: SIAL-CORE-006
  title: Migration — trigger de evento em mudança de status
  description: Função sial_log_status_change() + trigger AFTER UPDATE OF status conforme §7 (6).
  acceptanceCriteria:
    - "Trigger trg_sial_processo_status existe em Processo"
    - "UPDATE de status insere 1 Evento com statusAnterior/Novo corretos"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_trigger WHERE tgname='trg_sial_processo_status'"
      expected: "1"
  dependsOn: [SIAL-CORE-005]
  estimateMinutes: 25
  touches: ["supabase/migrations/"]

- id: SIAL-CORE-007
  title: Migration — função sial_transicao()
  description: Função SQL de transição conforme §7 (7); seta sial.usuario_id e atualiza status (o trigger registra o evento).
  acceptanceCriteria:
    - "sial_transicao(processo, novo, usuario) atualiza status e retorna a linha"
    - "Chamada gera Evento com usuarioId preenchido"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_proc WHERE proname='sial_transicao'"
      expected: "1"
  dependsOn: [SIAL-CORE-006]
  estimateMinutes: 25
  touches: ["supabase/migrations/"]

- id: SIAL-CORE-008
  title: state-machine.ts — tabela de transições + validateTransition
  description: Módulo TS com o mapa de transições legais por tipo (requerimento/denuncia) e validateTransition(tipo, de, para). Espelha a state machine do banco (defesa em profundidade).
  acceptanceCriteria:
    - "src/lib/sial/state-machine.ts exporta TRANSITIONS e validateTransition"
    - "Transição inválida (ex.: deferido→rascunho) retorna {ok:false}"
    - "Transições da modelagem §4 são todas permitidas"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 30
  touches: ["src/lib/sial/state-machine.ts"]

- id: SIAL-CORE-009
  title: DAL processo — create, get, transition, listEventos
  description: src/lib/sial/dal/processo.ts com criação de Processo+Protocolo (numero gerado), get, transition (valida via state-machine + chama RPC sial_transicao), listEventos.
  acceptanceCriteria:
    - "createProcesso cria Processo e Protocolo numa transação"
    - "transition rejeita transição inválida antes de chamar o banco"
    - "Gera numero de protocolo único legível (ex.: AAAA-NNNNNN)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-CORE-007, SIAL-CORE-008]
  estimateMinutes: 30
  touches: ["src/lib/sial/dal/processo.ts"]

- id: SIAL-CORE-010
  title: API POST /api/processos
  description: Cria Processo (rascunho) + Protocolo. Body validado por Zod (tipo, metodoId?, requerenteId?, dados?).
  acceptanceCriteria:
    - "POST retorna 201 com {processo, protocolo}"
    - "Validação Zod rejeita tipo inválido com 400"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-CORE-009]
  estimateMinutes: 25
  touches: ["src/app/api/processos/route.ts"]

- id: SIAL-CORE-011
  title: API GET /api/processos/:id + GET .../eventos
  description: Leitura do processo+protocolo e da timeline de eventos.
  acceptanceCriteria:
    - "GET /api/processos/:id retorna processo+protocolo+status"
    - "GET /api/processos/:id/eventos retorna eventos ordenados por createdAt"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-CORE-009]
  estimateMinutes: 20
  touches: ["src/app/api/processos/[id]/route.ts", "src/app/api/processos/[id]/eventos/route.ts"]

- id: SIAL-CORE-012
  title: API POST /api/processos/:id/transition
  description: Aplica transição validada. 409 se inválida. Registra usuarioId (vem do contexto até a PRD2 de auth).
  acceptanceCriteria:
    - "Transição válida retorna 200 + processo atualizado"
    - "Transição inválida retorna 409 com motivo"
    - "Evento correspondente é criado"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-CORE-009]
  estimateMinutes: 25
  touches: ["src/app/api/processos/[id]/transition/route.ts"]

- id: SIAL-CORE-013
  title: API GET /api/metodos + componente ProcessoTimeline
  description: GET /api/metodos?ativo=true (leitura) e componente React reutilizável ProcessoTimeline que renderiza eventos.
  acceptanceCriteria:
    - "GET /api/metodos retorna métodos ativos"
    - "ProcessoTimeline renderiza lista de eventos com data/usuario/status"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-CORE-011]
  estimateMinutes: 30
  touches: ["src/app/api/metodos/route.ts", "src/components/sial/processo-timeline.tsx"]

- id: SIAL-CORE-014
  title: Regenerar database.types.ts
  description: Atualiza os types do Supabase com as novas tabelas/enums.
  acceptanceCriteria:
    - "database.types.ts inclui Processo, Protocolo, Metodo, Evento e os enums"
    - "tsc passa com os novos types"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-CORE-007]
  estimateMinutes: 15
  touches: ["src/lib/supabase/database.types.ts"]

- id: SIAL-CORE-015
  title: Smoke — ciclo de vida do processo
  description: Cria um Processo, transiciona rascunho→aguardando_pagamento→enviado_analise→em_analise→deferido, confirma que cada transição gerou Evento e que transição inválida é barrada.
  acceptanceCriteria:
    - "5 transições válidas geram 5 eventos"
    - "Transição inválida (deferido→rascunho) retorna 409"
    - "ProcessoTimeline mostra os 5 eventos em ordem"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"Evento\" WHERE \"tipoEvento\"='status_change' AND \"processoId\"=(SELECT id FROM \"Processo\" ORDER BY \"createdAt\" DESC LIMIT 1)"
      expected: "5"
  dependsOn: [SIAL-CORE-012, SIAL-CORE-013]
  estimateMinutes: 25
  touches: ["(end-to-end)"]
```

**Total: 15 stories, ~345min (~5h45).**
