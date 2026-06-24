# PRD — Histórico & Movimentação de Membro/Alocação

> Status: backlog (Rito 1 não rodou). Origem: conversa 2026-06-24 (soft-delete de membro → "a gente mantém log dessa movimentação?").
> Relacionado: [[project_labor_allocation_model]], [[project_member_roles_access]], `Member.deactivatedAt` (ZRD-JM, 2026-06-24), [[project_finance_app]].

## 1. Problema

1. **Histórico de alocação se perde.** `finance.labor_allocation` é uma tabela temporal (`effective_from`/`effective_to`), e as views de billing ([v_allocation_labor_month](../../../supabase/migrations/20260623m_finance_labor_prorata.sql)) já reconstroem custo de mês passado. Mas o app **destrói o dado**: remover membro do contrato faz `DELETE` ([finance/dal.ts:484](../../../src/lib/finance/dal.ts#L484)); editar % faz `UPDATE` in-place ([finance/dal.ts:466](../../../src/lib/finance/dal.ts#L466)). O período "Fulano esteve no contrato X de A a B a Y%" — base da precificação acertada — some.
2. **Nenhuma trilha de movimentação.** Troca de PM (`Project.pmId`), troca de builder, entra/sai do roster (`ProjectMember`), desativação de membro — nada disso é registrado. Não há como responder "quem mexeu, quando, por quê".
3. **Desativar não fecha alocação.** O soft-delete de membro (já em prod) marca `deactivatedAt` mas deixa as alocações abertas. As views de billing não filtram por `deactivatedAt` → um demitido seguiria sendo custeado nos meses seguintes se o salário não for encerrado à mão.

## 2. Solução em uma frase

Tornar a alocação **temporal-honesta** (período nunca é apagado nem sobrescrito; correção é *void* reversível, não delete) e adicionar um **log de movimentação append-only** que registra toda mudança de membro/alocação/PM — preservando o histórico contratual para precificação e auditoria.

## 3. Não-objetivos

- Cálculo/automação de cobrança (NF, valores) — fora; isto só garante o **dado de quem-esteve-quando** que a cobrança consome.
- Reescrever as views de billing — elas já são temporalmente corretas; só precisam excluir voids.
- Audit log genérico de TODA tabela do sistema — escopo é membro/alocação/PM/roster.
- Versionar `finance.contract`/`invoice` em si (mudança de cláusula) — fase futura.

## 4. Personas e jornada

- **Admin/Head-Ops (financeiro):** "Demiti a Ana em março. Preciso que o contrato Acme mostre que ela esteve lá de jan a mar a 40% — pra cobrança bater — e que de abril ela não conte mais."
- **Admin (correção):** "Aloquei o PM errado por engano. Quero remover esse lançamento, **mas** sem que o histórico vire mentira: tem que ficar claro que foi um erro removido, não que nunca existiu."
- **Admin (LGPD, raro):** "Preciso apagar de vez um dado sensível lançado por engano — e ainda assim quero que fique registrado que houve um expurgo."
- **PM/Manager (auditoria):** "Quem tirou o Marcos desse projeto e quando? Quem virou PM no lugar da Brenda?"

## 5. Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | **Valor financeiro de um período é imutável.** `percent`, `days`, `effective_from`, `contract_id` de uma linha de `labor_allocation` nunca mudam in-place. Só `note` é editável. | Período cobrado que muda de valor depois = histórico não confiável. |
| D2 | **Mudança real ao longo do tempo = fechar + nova linha.** Mudar % a partir de uma data: `effective_to` na linha vigente + `INSERT` de novo período. | A infra de billing já soma por período; preserva o que foi cobrado antes. |
| D3 | **Encerrar ≠ Remover.** Encerrar (`effective_to`) = a pessoa esteve e saiu (conta no billing até a data). Remover (erro) = a linha não devia existir (sai do billing). | São fatos diferentes; misturar perde o caso de cima. |
| D4 | **Remover = void (soft), não delete.** `voided_at`/`voided_reason`/`voided_by`; sai do billing; some dos rosters; visível com toggle "Mostrar removidos"; **Restaurar** desfaz. | "Logs são ofícios e reais": nada some silenciosamente; correção fica rastreada. |
| D5 | **Purge (hard delete) existe, mas é admin + raro + logado.** Só super-admin; pra LGPD/dado sensível; gera evento `allocation_purged` no log de movimentação antes de apagar a linha. | Cobre o caso legal extremo sem abrir a porta pro delete silencioso do dia a dia. |
| D6 | **Log de movimentação é imutável.** `MemberMovementEvent` append-only (`REVOKE INSERT/UPDATE/DELETE` de authenticated; escrita via service_role). Registra inclusive voids e purges. | É a camada que prova que a frente (editável) é honesta. |
| D7 | **Desativar membro fecha as alocações abertas dele** na data do desligamento (`effective_to = data`), em transação. Reativar NÃO reabre — re-alocação é ação explícita. | Para de custear depois que saiu; preserva o período; reflete a realidade (houve um gap). |
| D8 | **Side sheet por contrato** é a superfície de leitura/correção do histórico de alocação. Reusa `ResponsiveSheet` + idioma "mostrar removidos" (espelha o toggle de membros inativos). | Consistência com o padrão já shipado; admin-only. |
| D9 | **Faseamento:** F1 = alocação honesta + void + side sheet + desativar-fecha. F2 = `MemberMovementEvent` + purge. F3 = eventos de PM/roster/squad no log. | F1 entrega o valor financeiro (o que sangra hoje) sem depender do log. |
| D10 | **RLS:** alocação e side sheet = admin/manager (segue `finance` schema, admin-only). Log de movimentação: leitura manager+ ou membro do projeto; escrita service_role. | Dado financeiro é sensível; o log é mais amplo pra governança. |

## 6. Arquitetura

```
┌─────────────────────────── Camada 1 — SSOT temporal ───────────────────────────┐
│  finance.labor_allocation (período = fato imutável)                            │
│    + voided_at / voided_reason / voided_by   (void soft, D4)                    │
│    + closed_by                               (quem encerrou, D3)                │
│    create=INSERT período · change=close+INSERT (D2) · fix=void+INSERT · note=edit│
│         │                                                                       │
│         ├──► v_allocation_labor_month / v_*_labor_month  (WHERE voided_at NULL)  │ billing por mês passado
│         └──► v_contract_roster / v_project_team          (vigente, não-void)     │ roster atual
└─────────────────────────────────────────────────────────────────────────────────┘
                                   │ toda mutação emite ▼
┌─────────────────────────── Camada 2 — log imutável (F2) ──────────────────────┐
│  MemberMovementEvent (append-only, service_role)                               │
│    kind: allocation_added | allocation_closed | allocation_voided |            │
│          allocation_restored | allocation_purged | allocation_period_changed | │
│          pm_assigned | pm_unassigned | added_to_project | removed_from_project │
│          | member_deactivated | member_reactivated                             │
│    refs: memberId, projectId?, contractId?, allocationId?  · payload(before/after)│
│    actorMemberId · createdAt                                                    │
└─────────────────────────────────────────────────────────────────────────────────┘
        ▲                         ▲                          ▲
   side sheet "Histórico    PATCH .../status         endpoints de void/
   de alocação" (F1, D8)    (desativar fecha, D7)    restore/purge (F1/F2)
```

Cada caixa = tabela/view/endpoint real (nomes no §7/§8).

## 7. Schema (DDL — migrations atômicas, 1 por arquivo)

**M1 — void + closed_by em labor_allocation (F1):**
```sql
ALTER TABLE finance.labor_allocation
  ADD COLUMN voided_at     timestamptz,
  ADD COLUMN voided_reason text,
  ADD COLUMN voided_by     uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  ADD COLUMN closed_by     uuid REFERENCES public."Member"(id) ON DELETE SET NULL;
CREATE INDEX labor_alloc_live_idx ON finance.labor_allocation (contract_id)
  WHERE voided_at IS NULL;
```

**M2 — billing/roster views excluem voids (F1):** `CREATE OR REPLACE` de `v_allocation_labor_month`, `v_project_member_labor_month`, `v_project_labor_month`, `v_contract_roster`, `finance.v_project_team` adicionando `AND la.voided_at IS NULL` no FROM de `labor_allocation`. (Atômico: 1 arquivo recria o conjunto, como [20260527](../../../supabase/migrations/20260527_exclude_guests_from_team_views.sql) fez.)

**M3 — MemberMovementEvent (F2):**
```sql
CREATE TABLE "MemberMovementEvent" (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "memberId"      uuid REFERENCES "Member"(id) ON DELETE SET NULL,
  "projectId"     uuid REFERENCES "Project"(id) ON DELETE CASCADE,
  "contractId"    uuid REFERENCES finance.contract(id) ON DELETE SET NULL,
  "allocationId"  uuid,                       -- ref histórica; alocação pode ter sido purgada
  kind            text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { before, after, reason, ... }
  "actorMemberId" uuid REFERENCES "Member"(id) ON DELETE SET NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "MemberMovementEvent_member_idx"   ON "MemberMovementEvent"("memberId", "createdAt" DESC);
CREATE INDEX "MemberMovementEvent_contract_idx" ON "MemberMovementEvent"("contractId", "createdAt" DESC);
CREATE INDEX "MemberMovementEvent_project_idx"  ON "MemberMovementEvent"("projectId", "createdAt" DESC);

ALTER TABLE "MemberMovementEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY mme_read ON "MemberMovementEvent" FOR SELECT
  USING (is_manager() OR can_view_project("projectId"));
-- Append-only: sem policy de INSERT/UPDATE/DELETE pra authenticated; escrita só via service_role.
REVOKE INSERT, UPDATE, DELETE ON "MemberMovementEvent" FROM authenticated;
GRANT SELECT ON "MemberMovementEvent" TO authenticated;
```

## 8. APIs

| Método | Path | Contrato | Fase |
|--------|------|----------|------|
| GET | `/api/contracts/[id]/allocations` | `{ periods: AllocationPeriod[] }` incl. encerrados; `?includeVoided=1` adiciona voids (admin) | F1 |
| POST | `/api/finance/allocations/[id]/void` | `{ reason }` → 200; seta `voided_*`; (F2: emite `allocation_voided`) | F1 |
| POST | `/api/finance/allocations/[id]/restore` | `{}` → 200; limpa `voided_*`; (F2: emite `allocation_restored`) | F1 |
| POST | `/api/finance/allocations/[id]/close` | `{ effectiveTo }` → 200; encerra período (`effective_to`,`closed_by`) | F1 |
| (alterar) | `PUT /api/members/[id]/allocations` | mudança de período = close+insert (D2); fix = void+insert; **nunca** delete/overwrite | F1 |
| (alterar) | `PATCH /api/members/[id]/status` | desativar fecha alocações abertas em tx (D7) | F1 |
| DELETE | `/api/finance/allocations/[id]/purge` | super-admin; emite `allocation_purged` ANTES do delete (D5) | F2 |
| GET | `/api/members/[id]/movements` ou `/api/contracts/[id]/movements` | `{ events: MemberMovementEvent[] }` | F2/F3 |

Nenhuma envolve LLM/job → síncronas.

## 9. UX

Side sheet "Histórico de alocação do contrato" (D8), admin-only:
```
┌─ Histórico de alocação · Contrato Acme #1234 ──── [ Mostrar removidos ◯ ] ─┐
│  Eduarda Rodrigues · Builder                                              │
│    50%  ·  01/jan → vigente                            [ Encerrar ]  [⋯]  │
│    alocada por João · 02/jan                                              │
│  Marcos Lima · Builder                                                     │
│    30%  ·  01/fev → 15/mar · encerrado                              [⋯]   │
│    saiu · encerrado por João · 15/mar                                     │
│  ── (toggle ligado) ──                                                    │
│  Ana Souza · PM   [riscado] 40% · 01/jan → 10/jan  REMOVIDO (erro)        │
│    "PM errado" · removido por João · 10/jan          [ Restaurar ]        │
└────────────────────────────────────────────────────────────────────────────┘
```
- `[⋯]`: Editar (só `note`) · Encerrar · Remover (erro, pede motivo). Purge fica em sub-menu admin "Apagar definitivo" (F2).
- Default esconde voids; toggle revela (riscado + Restaurar). Espelha o toggle "Mostrar inativos" dos membros.

## 10. Integrações

- **Billing / Finance App** ([[project_finance_app]]): consome as views temporais já existentes; ganha exatidão (período preservado, void excluído).
- **Soft-delete de membro** (já em prod): `PATCH .../status` passa a fechar alocações (D7); revisa a nota "não mexe em alocação".
- **v_project_team / roster**: exclui voids além de inativos.
- **Metrics Registry** ([[project_metrics_registry]]): base futura pra lead time/turnover por contrato (eventos do log).

## 11. Faseamento

- **F1 (entrega o valor financeiro):** M1+M2; mutação de alocação vira honesta (close+insert / void+insert, nunca delete/overwrite); endpoints void/restore/close; side sheet por contrato com toggle; desativar fecha alocações (D7). **Já é mais que hoje** — hoje o dado some.
- **F2:** M3 `MemberMovementEvent`; void/restore/close/desativar passam a emitir eventos; purge admin (D5); GET movements.
- **F3:** eventos de `pm_assigned/unassigned`, `added/removed_from_project`, squad; timeline de movimentação por membro/projeto.

## 12. Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Sessão concorrente em `finance/dal.ts` ([[project_contract_allocation_ssot]]) | Média | Conflito de merge | Coordenar antes de F1; edits cirúrgicos nas funções `create/update/deleteAllocation`. |
| Views de billing quebrarem ao adicionar filtro de void | Baixa | Cobrança errada | `CREATE OR REPLACE` testado em tx revertida + comparar Σ labor_cents antes/depois (deve bater com void=0). |
| Backfill: linhas já deletadas no passado | Alta | Histórico pré-F1 incompleto | Aceito e documentado — não dá pra recuperar o que já foi `DELETE`. F1 estanca daqui pra frente. |
| Desativar-fecha-alocação surpreender em reativação | Média | Admin espera roster de volta | UX deixa claro: reativar restaura login/visibilidade, não alocações; re-alocar é explícito. |

## 13. Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Zero perda de período pós-F1 | `SELECT count(*) FROM finance.labor_allocation WHERE voided_at IS NOT NULL` cresce; nenhum DELETE em logs do endpoint (grep `deleteAllocation`). |
| Billing de mês passado reproduzível | Query `v_allocation_labor_month` pra mês fechado retorna mesmo Σ em re-execução após desativações. |
| Toda correção rastreada | F2: `SELECT count(*) FROM "MemberMovementEvent" WHERE kind IN ('allocation_voided','allocation_purged')` = nº de remoções na UI. |
| Demitido para de custear | Após desativar, `v_allocation_labor_month` do membro = 0 nos meses > data de saída. |

## 14. Open questions

- (F3) Eventos de PM/roster: trigger no `Project.pmId`/`ProjectMember` vs emissão no DAL? Resolver no início da F3 (preferência: DAL, como `task-activity-recorder`).
- Granularidade do "purge": linha única vs cascata por membro? Default linha única (D5).

## 15. Referências

- Código vivo: [finance/dal.ts](../../../src/lib/finance/dal.ts), [labor_allocation views](../../../supabase/migrations/20260623m_finance_labor_prorata.sql), [v_project_team](../../../supabase/migrations/20260624s_v_project_team_exclude_inactive.sql).
- Padrão de log append-only: [ProjectPhaseEvent](../../../supabase/migrations/20260616b_project_phase_event.sql), [TaskActivity](../../../supabase/migrations/20260501_task_activity.sql) + [task-activity-recorder.ts](../../../src/lib/dal/task-activity-recorder.ts).
- Padrão soft-delete + toggle: `Member.deactivatedAt` (members-view.tsx, 2026-06-24).
- Memories: [[project_labor_allocation_model]], [[project_finance_app]], [[project_member_roles_access]].

## 16. Stories implementáveis

```yaml
- id: MAH-001
  title: Adicionar colunas de void + closed_by em labor_allocation
  description: Migration M1 — voided_at/voided_reason/voided_by + closed_by + índice parcial live.
  acceptanceCriteria:
    - "Colunas voided_at, voided_reason, voided_by, closed_by existem em finance.labor_allocation"
    - "Índice parcial labor_alloc_live_idx (WHERE voided_at IS NULL) criado"
  verifiable:
    - kind: sql
      command_or_query: "\\d finance.labor_allocation"
      expected: "voided_at, voided_reason, voided_by, closed_by presentes"
  dependsOn: []
  estimateMinutes: 15
  touches: [supabase/migrations]

- id: MAH-002
  title: Excluir voids das views de billing e roster
  description: CREATE OR REPLACE das v_*_labor_month + v_contract_roster + v_project_team com AND voided_at IS NULL.
  acceptanceCriteria:
    - "v_allocation_labor_month ignora linhas com voided_at"
    - "Σ labor_cents inalterado quando não há voids"
  verifiable:
    - kind: sql
      command_or_query: "BEGIN; UPDATE finance.labor_allocation SET voided_at=now() WHERE id=(SELECT id FROM finance.labor_allocation LIMIT 1); SELECT count(*) FROM v_allocation_labor_month WHERE allocation_id IN (SELECT id FROM finance.labor_allocation WHERE voided_at IS NOT NULL); ROLLBACK;"
      expected: "0"
  dependsOn: [MAH-001]
  estimateMinutes: 25
  touches: [supabase/migrations]

- id: MAH-003
  title: DAL — alocação nunca deleta nem sobrescreve valor
  description: createAllocation=INSERT; mudança de período=close+insert; fix=void+insert; só note edita in-place. Remover deleteAllocation do caminho de UI.
  acceptanceCriteria:
    - "Nenhuma chamada .delete() de labor_allocation no fluxo de UI"
    - "updateAllocation não altera percent/days/effective_from/contract_id de linha existente"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "0 erros"
  dependsOn: [MAH-001]
  estimateMinutes: 30
  touches: [src/lib/finance/dal.ts, src/app/api/members/[id]/allocations/route.ts]

- id: MAH-004
  title: Endpoints void / restore / close
  description: POST .../void {reason}, POST .../restore, POST .../close {effectiveTo}. Admin-only.
  acceptanceCriteria:
    - "void seta voided_at/reason/by; restore limpa; close seta effective_to+closed_by"
    - "não-admin recebe 403"
  verifiable:
    - kind: http
      command_or_query: "POST /api/finance/allocations/<id>/void {reason:'teste'} como admin"
      expected: "200 e voided_at preenchido"
  dependsOn: [MAH-001]
  estimateMinutes: 30
  touches: [src/app/api/finance/allocations]

- id: MAH-005
  title: Desativar membro fecha alocações abertas (D7)
  description: PATCH /api/members/[id]/status active:false passa a setar effective_to=hoje nas labor_allocation abertas do membro, em transação.
  acceptanceCriteria:
    - "Após desativar, membro não tem labor_allocation com voided_at IS NULL AND effective_to IS NULL"
    - "Reativar não reabre alocações"
  verifiable:
    - kind: sql
      command_or_query: "(após desativar via endpoint) SELECT count(*) FROM finance.labor_allocation WHERE member_id=<id> AND effective_to IS NULL AND voided_at IS NULL"
      expected: "0"
  dependsOn: [MAH-001]
  estimateMinutes: 25
  touches: [src/app/api/members/[id]/status/route.ts]

- id: MAH-006
  title: Side sheet "Histórico de alocação do contrato"
  description: ResponsiveSheet admin-only; timeline de períodos (membro, %, from→to, status); ações Encerrar/Editar-note/Remover(erro); toggle "Mostrar removidos" + Restaurar.
  acceptanceCriteria:
    - "Lista períodos ativos+encerrados; toggle revela voids riscados com Restaurar"
    - "Remover pede motivo e chama .../void"
  verifiable:
    - kind: manual_browser
      command_or_query: "Abrir side sheet de um contrato, remover (erro) um período, ligar toggle, restaurar"
      expected: "período some/reaparece riscado/volta; nada apagado do banco"
  dependsOn: [MAH-004]
  estimateMinutes: 30
  touches: [src/components/finance]

- id: MAH-007
  title: Tabela MemberMovementEvent (append-only)
  description: Migration M3 + RLS append-only (REVOKE write de authenticated).
  acceptanceCriteria:
    - "Tabela e índices existem; authenticated não consegue INSERT/UPDATE/DELETE"
  verifiable:
    - kind: sql
      command_or_query: "SELECT has_table_privilege('authenticated','\"MemberMovementEvent\"','INSERT')"
      expected: "f"
  dependsOn: []
  estimateMinutes: 20
  touches: [supabase/migrations]

- id: MAH-008
  title: Emitir eventos nas mutações de alocação + desativação
  description: void/restore/close/createAllocation/desativar emitem MemberMovementEvent via recorder (espelha task-activity-recorder).
  acceptanceCriteria:
    - "Cada ação grava 1 evento com kind+actor+refs+payload(before/after)"
  verifiable:
    - kind: sql
      command_or_query: "(após void) SELECT kind FROM \"MemberMovementEvent\" ORDER BY \"createdAt\" DESC LIMIT 1"
      expected: "allocation_voided"
  dependsOn: [MAH-007, MAH-004]
  estimateMinutes: 30
  touches: [src/lib/dal, src/app/api/finance/allocations]

- id: MAH-009
  title: Purge admin (D5) — hard delete logado
  description: DELETE .../purge super-admin; emite allocation_purged ANTES de apagar a linha.
  acceptanceCriteria:
    - "Evento allocation_purged persiste mesmo após a linha sumir"
    - "não-super-admin recebe 403"
  verifiable:
    - kind: sql
      command_or_query: "(após purge) SELECT count(*) FROM \"MemberMovementEvent\" WHERE kind='allocation_purged'"
      expected: ">= 1"
  dependsOn: [MAH-008]
  estimateMinutes: 25
  touches: [src/app/api/finance/allocations]
```
