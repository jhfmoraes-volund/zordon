# RUNBOOK — Finance Billing · RB3 Automação (B4–B7)

> 3º de 3 ([RB1 schema](finance-contract-billing-rb1-schema.md) · [RB2 superfície](finance-contract-billing-rb2-surface.md) · RB3 automação).
> Plano: [contract-billing-and-agent-fill-plan.md](../features/finance/contract-billing-and-agent-fill-plan.md).
> **Depende de RB1+RB2.** Objetivo: as camadas "automáticas" — deep-link de cronograma, selos de procedência, agente coletor e integração de storage. Cada fase é **independente** (pode ser priorizada por valor).

## 0. INVARIANTES
- **Procedência sticky:** manual > integration > agent. Re-rodar o agente **nunca** sobrescreve campo `source='manual'` (salvo `force` explícito).
- **⚠️ Auth do agente (resolver no início do B6 — contradição que o audit pegou):** o router de tools roda como `service_role` (bypassa RLS) e **sem** checagem admin. Finance é admin-only → tool de finance **ou** roteia pelas `/api/finance/*` (preserva o gate) **ou** checa `is_admin()`/actor-admin dentro do `execute()` antes de escrever. "Endpoints viram tools" (3.3) é OK **só** com essa auth garantida; **não** herdar o padrão sem-auth das tools de leitura do Alpha. Procedência `source='agent'`+`runId` server-side.
- **Tabelas `contract_planned_role` + `contract_document` nascem AQUI** (Slice 4), não no RB1 — só quando o agente existe pra preenchê-las. (⚠️ `contract_planned_role` = previsão senioridade+headcount extraída do contrato pelo agente, **≠** `labor_allocation` = equipe real por nome — não confundir nem duplicar.)
- **Storage-agnóstico:** UI fala com `contract_document (provider+external_ref)`; cada provider é um adapter. Doc com casa oficial = **vincular** (referência, não copia).
- **Tool de agente vive em 2 repos** (monorepo executa + `zordon-daemon` anuncia schema) — toda tool nova edita os dois ([[project_daemon_tool_advertisement]]).

## 1. FASES (independentes; priorizar por valor)

### Fase 3.1 (B4) — Deep-link do cronograma → Planning / PM Review
- Chip de sprint (RB2.4) abre destino: `/projects/[id]/planning?sprint=<id>` e `/projects/[id]/pm-review?week=<iso>` (rotas **já existem**).
- Fazer as duas rotas **aceitarem o foco** (`?sprint=`/`?week=`) e abrirem já no ponto (PM Review tem cronograma navegável por semana; Planning é por sprint).
- UX: popover "Ver no Planning · Ver no PM Review" (como no mock) ou navegação direta.
**Verify (browser):** clicar a sprint 5 → Planning abre focado nela; → PM Review abre na semana correspondente.

### Fase 3.2 (B5) — Selos de procedência + regra sticky
- Ler `provenance` (jsonb) e renderizar badge por campo/seção: *"preenchido pela IA"* (com `confidence`) vs *"editado por você"*.
- **PATCH** faz **deep-merge** (`provenance || jsonb_build_object(campo,…)`, nunca substitui o mapa) e seta `source='manual'` no campo. **Sticky em 1 SQL** com `WHERE` no source atual (não SELECT-depois-UPDATE — race): o coletor (3.3) só escreve campo cujo source ≠ 'manual' salvo `force`.
- Aplica em contrato (termos/cláusulas), planned-role, e onde o agente preenche.
**Verify automatizável:** set campo manual → roda agente → asserta inalterado (sem isso regride silencioso).

### Fase 3.3 (B6) — Agente coletor (contrato/proposta → preenche)
- **Cria** `contract_planned_role` + `contract_document` (migrations adiadas do RB1 até aqui).
- **`contract_document` REUSA a máquina do ContextSource** (`extractTextFromBuffer` + adapter Drive) e **cacheia `full_text`** — a tabela sozinha só guarda `external_ref`/`url`, então sem o texto extraído o agente **não tem o que ler**. RLS **admin** (NÃO a tabela do ContextSource, que é `can_view_project`; espelhar a policy `is_admin()` do bucket member-photos).
- Endpoints de escrita viram **tools** (ToolDescriptor) nos **2 repos** (auth: ver §0); execução proxied.
- Pipeline: lê o `full_text` → extrai termos/valores/cláusulas/condição-NF/**time planejado (senioridade+headcount)** → escreve `source='agent'`+`confidence`. **Nomes de pessoas = manuais** (P3). **Emissão de NF = humana** (agente NÃO cria `invoice` — Q1 sem unique = risco de dup).
- Doc do Drive → **referência** (`provider='gdrive'`), não copia.
**Verify:** roda contra contrato real → campos com selo IA; manual preservado; **nenhuma `invoice` criada pelo agente**; CLI calibração verde.

### Fase 3.4 (B7) — Integração de storage (Drive / SharePoint / ERP)
- Adapter por `provider`: `gdrive` (Composio googledrive — **já existe**, [[project_drive_integration]]), `sharepoint` (novo), `erp` (NF XML, novo). `resolve(external_ref) → url/stream`.
- Slot "Documentos"/"Anexo da NF" (RB2.6/2.7) ganha **"Vincular do Drive/SharePoint"** (picker) além do upload.
- Política: oficial (proposta/contrato) = vincular; avulso (NF solta) = upload Supabase.
**Verify:** vincular um arquivo do Drive → abre via adapter; upload Supabase segue funcionando; `contract_document` não muda de shape.

## 2. GOTCHAS
- **Não** reescrever o motor de receita por causa do agente — ele só preenche dados; receita segue as views (Q4).
- Tool em 2 repos: esquecer o daemon = tool **ininvocável**. Regenerar manifest/guard cross-repo se houver ([[project_daemon_tool_advertisement]]).
- Provenance sticky precisa de teste explícito (re-run não sobrescreve manual) — senão regride silencioso.
- SharePoint/ERP são integrações novas (auth/permite) — escopar como sub-projeto próprio se crescer.
- Confiar mas verificar: conteúdo gerado por agente vem com **ref tipada** ao doc-fonte ([[feedback_grounded_no_hallucination]]); sem ref clicável, não publica.

## 3. COMMIT
- Monorepo: `bash scripts/sync-main.sh`. Daemon (3.3): `bash scripts/sync.sh -m "feat(agent): finance tools" --no-restart` (conventional, nunca `ZRD-JM` no daemon) + reiniciar daemon p/ valer.
- 1 commit por fase (são independentes).

## 4. REFERÊNCIAS
- Plano: [contract-billing-and-agent-fill-plan.md](../features/finance/contract-billing-and-agent-fill-plan.md)
- Rotas-alvo: `src/app/(dashboard)/projects/[id]/planning` · `…/pm-review`
- Padrões: `ToolDescriptor` (2 repos) · `ContextSource`/Composio (storage) · memórias [[project_daemon_tool_advertisement]] · [[project_drive_integration]] · [[project_context_source_pool]] · [[feedback_grounded_no_hallucination]]
