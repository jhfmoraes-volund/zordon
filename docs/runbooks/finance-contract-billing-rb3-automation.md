# RUNBOOK — Finance Billing · RB3 Automação (B4–B7)

> 3º de 3 ([RB1 schema](finance-contract-billing-rb1-schema.md) · [RB2 superfície](finance-contract-billing-rb2-surface.md) · RB3 automação).
> Plano: [contract-billing-and-agent-fill-plan.md](../features/finance/contract-billing-and-agent-fill-plan.md).
> **Depende de RB1+RB2.** Objetivo: as camadas "automáticas" — deep-link de cronograma, selos de procedência, agente coletor e integração de storage. Cada fase é **independente** (pode ser priorizada por valor).

## 0. INVARIANTES
- **Procedência sticky:** manual > integration > agent. Re-rodar o agente **nunca** sobrescreve campo `source='manual'` (salvo `force` explícito).
- **Endpoints provenance-aware** já existem (RB1.8) — o agente **chama as mesmas APIs** com `source='agent'` + `runId`/`confidence`. Não criar caminho de escrita paralelo.
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
- **PATCH** de qualquer campo seta `provenance[campo].source='manual'` e **gruda**; o coletor (3.3) respeita.
- Aplica em contrato (termos/cláusulas), planned-role, e onde o agente preenche.
**Verify:** editar um campo IA → vira "editado"; re-rodar agente (3.3) **não** sobrescreve.

### Fase 3.3 (B6) — Agente coletor (contrato/proposta → preenche)
- Endpoints de escrita (RB1.8) viram **tools** (ToolDescriptor) nos **2 repos**; execução proxied, schema anunciado pelo daemon.
- Pipeline: lê `contract_document` (proposta/contrato/SOW) → extrai termos/valores/cláusulas/condição-NF/**time planejado (senioridade+headcount)** → escreve com `source='agent'` + `confidence`. **Nomes de pessoas continuam manuais** (P3).
- Doc lido do Drive → **referência** (`provider='gdrive'`), não copia (anti-duplicação).
**Verify:** rodar contra um contrato real → campos preenchidos com selo IA; manual anterior preservado; CLI de calibração verde se aplicável.

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
