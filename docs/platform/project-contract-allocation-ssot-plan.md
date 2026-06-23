# Plano — Project / Contract / Proposal + Alocação como Single Source of Truth

> Status: **proposto** (2026-06-23). Decisões fechadas com o João (head of ops). Não construído.
> Objetivo duplo: SSOT de **dados** (um dono por fato) **e** de **experiência** (uma interface, um responsável — "quem faz o quê" inequívoco).

## 1. Problema

Criar um projeto hoje mistura três coisas distintas num form chato de 14 campos, e a alocação de membro está espalhada por **5 semânticas e ~16 caminhos de escrita** — só os de Finanças são admin-gated. Consequências concretas:

1. **Datas/engajamento/equipe duplicam** entre `Project` e `finance.contract` → dois donos, drift garantido.
2. **"Proposta" não existe** como entidade — só um campo texto `proposal_ref`. O funil proposta→piloto/MVP→contrato não tem casa.
3. **Roster é lido de 3 jeitos diferentes** (UNION pmId+ProjectMember+squad em Vitoria, Alpha e `/api/projects/[id]/members`) → ninguém concorda em quem está no projeto.
4. **Qualquer um aloca** — project-edit sheet, members API, agente Alpha e squad UNION criam membership sem checagem de admin. Como head of ops, o João recebe pedidos de mudança sem um lugar canônico pra atendê-los.

## 2. Solução em uma frase

O **Contrato** é a verdade comercial (datas, faturamento, valor, **roster + %**); o **Projeto** projeta esses valores; **Proposta = Contrato em `status='proposed'`**; e **toda alocação de membro passa pela interface do contrato (Finanças), admin-only** — o Projeto só lê.

## 3. Não-objetivos

- Não unificar `ProjectMember.fpAllocation` (teto de PFV de planning) com `labor_allocation.percent` (custo). São números diferentes — ver D7.
- Não confundir `SprintMember.fpAllocation` (teto de PFV por sprint, planning) com **participação pontual** (custo %, D11). São eixos diferentes: capacidade vs custo. `SprintMember` fica como está.
- Não tirar o agente Alpha de cena — ele passa a **só atualizar** (PFV teto em quem já está alocado), nunca inserir membro.
- Não construir motor de versionamento de proposta (múltiplas opções de preço). Proposta = 1 contrato em `proposed`.

## 4. Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| **D1** | **Proposta = `finance.contract.status='proposed'`** (sem tabela nova). Ganhar = flip pra `active`. Piloto/MVP = contrato curto. | "Proposta e contrato são a mesma coisa em estágios diferentes" (João). Reusa todos os campos do contrato. |
| **D2** | **Contrato é dono de datas/engajamento; Projeto deriva.** | Já meio-construído: trigger `contract_sync_project_dates` (20260623h) escreve `Project.startDate/endDate` a partir de min/max das vigências. |
| **D3** | **Internal usa client 'Volund'** (clientId continua required, sem mudança de schema). | Sem relaxar constraint nem queries que assumem cliente. |
| **D4** | **Kind selector no new-project sheet**: Interno / Proposta / Contratado decide o que é criado. | Um clique no topo molda o form e o lifecycle. |
| **D5** | **Fase é independente do status do contrato.** Contratado pode estar em Imersão / Ops / Pós-Ops. Só `commercial` fica reservada à Proposta. | Corrige acoplamento errado do 1º mock. |
| **D6** | **`labor_allocation` é o roster de record (quem + %); contrato/Finanças é o único escritor, admin-only.** Projeto **lê**. | SSOT de dados + de experiência. Alocação vira processo admin (João assume isso conscientemente). |
| **D7** | **Internos (sem contrato) alocam com `contract_id=null`**, mesma interface admin. | Tabela já permite `contract_id` nullable (20260624c). Um mecanismo só em todo lugar. |
| **D8** | **Acesso ≠ alocação.** `%` é admin/contrato; mas `ProjectAccess` (role viewer/guest) continua dando acesso view-only a quem não tem `%` (revisor/observador). | Preserva guest-access hardening existente. Roster = alocados ∪ access-only. |
| **D9** | **Squad linkada = pool/contexto, NÃO membership.** Estar na squad do projeto não te põe no roster — só alocação põe. | Tira squad do UNION de "quem está". Squad continua derivando PM e listando o pool disponível. |
| **D10** | **Um leitor canônico de roster**: `getProjectTeam(projectId, at?)` = alocados (de `labor_allocation`) ∪ access-only (de `ProjectAccess`). Os 3 readers atuais passam a chamá-lo. | Mata os 3 UNIONs divergentes. |
| **D11** | **Participação pontual (spot) = `labor_allocation` com `kind='spot'` ancorada a um sprint** (`sprint_id`), com `%` de ajuda. Mesmo SSOT, mesma interface admin. Vigência = janela do sprint → custo entra só naquele período. Builder spot ganha `ProjectAccess` (contributor) temporário pela vigência. | "Frequente: alguém entra pra ajudar 1-2 sprints, põe 5-10%, alimenta cálculo" (João). Tabela própria re-fragmentaria o que estamos unificando. |
| **D12** | **Seleção de sprints = TagPicker** (`src/components/tags/tag-picker.tsx` em pure-selection, `max`≥12) — mesmo chip multi-select das tags de task. Selecionar N sprints faz **fan-out em N rows** `spot` (1 por sprint), mesmo `%`. | João: "escolher sprint é igual a adicionar tag — escala pra 12+, navegação melhor". 1 row/sprint mantém custo-por-sprint limpo e reusa componente existente. |

## 5. Modelo alvo

```
Opportunity ──promote()──▶ Project ──── tem ───▶ Contract(s)        [verdade comercial]
(candidato)               (identidade)            status: proposed→active→ended/declined
                              │                    effective_from/to, billing_type, valor
                              │                         │
                   ┌──────────┴───────────┐            └── labor_allocation (roster + %)  ◀── ÚNICO escritor de alocação (admin)
                   ▼                       ▼                         │
            ProjectAccess            startDate/endDate               │ deriva
         (acesso: lead/viewer/guest) engagementType  ◀── trigger ────┘
                   │                  (read-through do contrato ativo)
                   └──────────────┬───────────────────────────────────┐
                                  ▼                                     ▼
                       getProjectTeam(projectId, at?)  =  alocados ∪ access-only   [leitor único]
```

- **Project = identidade.** client, pmId, category (interno vs cliente), phase, `ProjectAccess`. Não é dono de datas/dinheiro.
- **Contract = verdade comercial.** datas, billing, valor, `labor_allocation` scoped. Lifecycle `proposed → active → ended` (+`declined`).
- **labor_allocation = roster de record.** Quem está alocado e quanto. Internos: `contract_id=null`.
- **ProjectAccess = camada de acesso.** Quem pode ver/agir (inclui guest/observador sem `%`).

## 6. Estado atual → alvo (caminhos de escrita)

| Caminho hoje | Tabela | Destino |
|---|---|---|
| project-edit member box (A1) + Project PUT replace (A2) | `ProjectMember` | **Removido.** Vira "Equipe (dos contratos)" read-only no sheet. |
| members API PUT (A4/A5) | `ProjectMember` + `labor_allocation` | **Redirecionado** pra escrever só `labor_allocation` (admin). |
| Alpha `manage_allocation` scope=project (A3) | `ProjectMember` | **Update-only** (PFV teto em quem já está alocado). Sem insert de membro. |
| contract sheet / finance API (B1–B5) | `labor_allocation` | **Mantido — é o SSOT.** Ganha `contract_id=null` pro caso interno. |
| squads table (C1–C2) | `ProjectSquad` | **Mantido**, mas sai do roster (D9): vira pool/contexto. |
| project-edit pmId (D1/D2) | `Project.pmId` | Mantido. |
| Alpha `manage_allocation` scope=sprint (E1/E2) | `SprintMember` | Mantido (não-objetivo). |
| 3 readers UNION (Vitoria / Alpha / API members) | leitura | **Colapsados** em `getProjectTeam()` (D10). |

## 7. Schema

Mudanças pequenas — a maior peça (sync de datas) já existe.

1. **`finance.contract.status`** — migration atômica nova:
   ```sql
   ALTER TABLE finance.contract
     ADD COLUMN status text NOT NULL DEFAULT 'active'
     CHECK (status IN ('proposed','active','ended','declined'));
   ```
   - Default `active` pros contratos-semente existentes (backfill 20260623h já criou 1 por projeto com prazo).
   - `proposal_ref` (texto) **fica** — agora só pra referência a proposta externa/PDF, não pra modelar a proposta.
2. **`labor_allocation`** — duas colunas novas pra suportar participação pontual (D11):
   ```sql
   ALTER TABLE finance.labor_allocation
     ADD COLUMN kind text NOT NULL DEFAULT 'standing'
       CHECK (kind IN ('standing','spot')),
     ADD COLUMN sprint_id uuid REFERENCES public."Sprint"(id) ON DELETE CASCADE;
   -- spot: sprint_id NOT NULL; effective_from/to derivam da janela do sprint.
   -- standing: sprint_id NULL (comportamento atual).
   ```
   `contract_id` já é nullable (internos). Ajustar validação Σ%≤100 por projeto pra considerar `contract_id=null` + somar spot vigentes no período.
3. **`getProjectTeam`** — view SQL ou função TS em `src/lib/dal/` que faz alocados ∪ access-only. (Decidir view vs TS na implementação; preferir view se os 3 readers precisam em SQL.)
4. **RLS** — `labor_allocation` já é admin-gated nas rotas; garantir POLICY explícita de write admin-only (auditar; D6 exige).

## 8. Faseamento

**Fase 1 — Lifecycle de contrato (entrega ≥ hoje).**
- `contract.status` + UI de status no contract sheet (proposed/active/ended/declined).
- Kind selector no new-project sheet (Interno/Proposta/Contratado) — cria Project (+ Contract no status certo).
- Datas/engagementType no project-edit viram read-only ("⤷ do contrato ativo"); internos mantêm manual.
- Transição "ganhar proposta": botão que faz `proposed→active` e bumpa fase `commercial→immersion` se ainda comercial.

**Fase 2 — Convergência de alocação (o coração).**
- `getProjectTeam()` canônico; apontar os 3 readers pra ele.
- project-edit member box → "Equipe (dos contratos)" read-only.
- Interface de alocação no contract sheet cobre `contract_id=null` (internos).
- Redirecionar members API + Alpha (insert→update-only).
- Remover squad do UNION (D9); manter como pool.
- **Participação pontual (D11):** colunas `kind`/`sprint_id`; UI no contract sheet → seção "Participações por sprint" (escolhe membro + sprint + %); chip no Planning/sprint view ("+2 builders pontuais: Ana 10%, Caio 5%"); auto-grant de `ProjectAccess` contributor pela vigência; custo aparece nos insights do mês do sprint (views já agregam por mês).

**Fase 3 — Limpeza + telemetria.**
- Auditar RLS write de `labor_allocation`.
- Deprecar caminhos de escrita mortos; logar qualquer write fora do contrato.
- Doc "quem aloca: head of ops, via Finanças" no runbook.

## 9. Riscos

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| Roster derivado deixa órfãos (quem estava em ProjectMember sem `%`) | Alta | Médio | Backfill: pra cada ProjectMember sem allocation, criar `labor_allocation` placeholder ou `ProjectAccess` viewer antes do cutover. |
| Internos sem contrato quebram leitura de equipe | Média | Médio | D7: alocação `contract_id=null`; `getProjectTeam` não exige contrato. |
| Alpha/Planning quebram ao perder insert de ProjectMember | Média | Médio | Update-only + erro claro "membro não alocado — alocar via contrato". |
| Σ% validation conflita entre contrato e nível-projeto | Média | Baixo | Validar por projeto somando contract-scoped + null-scoped vigentes. |

## 10. Open questions

- `getProjectTeam` = view SQL ou helper TS? (Resolver na Fase 2 — preferir view se Vitoria/Alpha leem direto do Postgres.)
- PFV teto (`ProjectMember.fpAllocation`) num roster derivado: qual default quando a linha passa a ser derivada de `labor_allocation`? (Planning define; default 0 e Alpha ajusta.)

## 11. UX / Wireframes

- **New-project sheet com kind selector** — `/tmp/project-kind-options.html`. Topo = seletor Interno/Proposta/Contratado; form se molda; datas derivadas read-only quando há contrato.
- **Interface de alocação (contrato · Equipe & Alocação)** — `/tmp/spot-allocation-options.html`. Equipe fixa (`standing`, % por membro) + Participações pontuais (`spot`) agrupadas por sprint, com form inline (builder + sprint + %). Downstream: chip pontual no sprint view + custo do sprint (stack fixa/spot, auto do `labor_allocation`).

## 12. Referências

- Mock interativo: `/tmp/project-kind-options.html`, `/tmp/spot-allocation-options.html`
- Trigger de datas: `supabase/migrations/20260623h_finance_contract_period_ssot.sql`
- `labor_allocation` + contract_id: `supabase/migrations/20260624c_finance_alloc_contract.sql`
- Readers a colapsar: `src/app/api/projects/[id]/members/route.ts`, `src/lib/agent/agents/vitoria/tools.ts` (loadProjectMembers), `src/lib/agent/agents/alpha/tools.ts` (get_allocated_project_members)
- Contract sheet: `src/components/apps/finance/finance-contract-sheet.tsx`
- Project sheet: `src/components/projects/project-edit-sheet.tsx`
- Memórias: project_project_contract_proposal_ssot, project_finance_app, project_labor_allocation_model, project_member_roles_access, project_guest_access, project_project_squad_from_pm
