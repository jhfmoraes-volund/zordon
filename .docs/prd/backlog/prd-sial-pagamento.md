# PRD — SIAL Pagamento (boleto e liberação para análise)

**Reference**: SIAL-PAG
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (React + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-requerimento`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: pagamento precede a análise (doc §6.1 passo 6), boleto/Monetário como meio (doc §9), `boleto` com status emitido/pago/vencido (modelagem §3).
- **[gap a validar]**: PIX/cartão e o mecanismo de confirmação de compensação (gap G5 / doc §10.5) — fora do MVP.
- **[inferência]**: webhook idempotente, `nossoNumero`, reemissão de boleto, interface `PagamentoGateway`, paths de API. A validar com a JUCESP.

## Demo/Mock (one-shot)

> Roda em **mock-mode** (`SIAL_MOCK=1`). O `PagamentoGateway` vem de `getGateways()` (stub gera `nossoNumero`/linha digitável). Na demo, o webhook de compensação é **disparado pelo próprio smoke** (`scripts/smoke/pagamento.ts`), sem banco real: emite boleto → simula webhook pago → confere `enviado_analise` via SQL. Monetário/banco real = Track B.

## §1 Problema

1. O pagamento **precede a análise**: o requerente gera boleto e paga antes do envio (doc §6.1 passo 6).
2. Sem confirmação **automática** da compensação, um servidor teria de conferir manualmente cada pagamento antes de liberar a fila.
3. Boleto vencido sem caminho de reemissão prende o requerente.

## §2 Solução em uma frase

Emite o boleto do serviço e libera o `Processo` para análise **somente após a compensação confirmada**, com status de pagamento visível e reemissão de boleto vencido.

## §3 Não-objetivos

- **PIX/cartão** — fora do MVP; é open question da JUCESP (gap G5). Esta PRD entrega **boleto** (o único meio citado no doc §9).
- O motor do banco/Monetário em si — consumido atrás de interface; integração real e resiliência ficam em `prd-sial-integracao-resiliencia`.

## §4 Personas e jornada

- **Requerente**: "Quero gerar o boleto, pagar e que o sistema reconheça sozinho que paguei, sem ter que provar nada à Junta."

## §5 Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | MVP só **boleto** (`Boleto.status` ∈ emitido/pago/vencido) | Único meio no doc §9; PIX/cartão é gap G5 a validar. Não muda contrato se entrarem depois. |
| D2 | **Gate de análise no status pago**: `aguardando_pagamento → enviado_analise` só após compensação | Doc §6.1; evita análise sem pagamento. Transição via `sial_transicao`. |
| D3 | Confirmação via **webhook idempotente** `/api/webhooks/pagamento` (com fallback de polling); mecanismo exato do Monetário a confirmar (G5) | Não inventar provedor; isolar atrás de interface `PagamentoGateway`. |
| D4 | Boleto vencido permite **reemissão** (novo Boleto, antigo marcado vencido) | Doc não trava o requerente em boleto morto. |
| D5 | `Boleto` 1:N com `Processo` (reemissões geram novas linhas) | Preserva histórico de tentativas; modelagem §3. |

## §6 Arquitetura

```
Processo (aguardando_pagamento)
   │ POST /api/processos/:id/boleto
   ▼
PagamentoGateway.emitir() ──► Boleto(status=emitido, linhaDigitavel, valor)
   │
   ▼ (requerente paga no banco)
POST /api/webhooks/pagamento {boletoId|nossoNumero, status:pago}  ← idempotente
   ├─ Boleto.status = pago, pagoEm = now()
   └─ sial_transicao(processo, aguardando_pagamento → enviado_analise)
```

## §7 Schema

```sql
-- 1) <data>_sial_boleto.sql
CREATE TABLE "Boleto" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "processoId" uuid NOT NULL REFERENCES "Processo"(id) ON DELETE CASCADE,
  valor numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'emitido' CHECK (status IN ('emitido','pago','vencido')),
  "linhaDigitavel" text,
  "nossoNumero" text UNIQUE,
  "vencimentoEm" date,
  "pagoEm" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "Boleto_processo_idx" ON "Boleto" ("processoId");
CREATE INDEX "Boleto_status_idx" ON "Boleto" (status);
ALTER TABLE "Boleto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "boleto_select" ON "Boleto" FOR SELECT USING (EXISTS (
  SELECT 1 FROM "Processo" p WHERE p.id="processoId"
    AND (p."requerenteId"=sial_current_usuario() OR sial_is_servidor())));
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| POST | `/api/processos/:id/boleto` | emite via PagamentoGateway → 201 `{boleto}`; 409 se já houver boleto pago |
| GET | `/api/processos/:id/boleto` | → boleto vigente + status |
| POST | `/api/processos/:id/boleto/reemitir` | marca vencido o atual, emite novo → 201 |
| POST | `/api/webhooks/pagamento` | `{nossoNumero, status}` → idempotente: marca pago + transição → 204 |

## §9 UX

```
┌──── Pagamento — protocolo 2026-000123 ────┐
│ Valor: R$ 89,40                            │
│ Linha digitável: 23793.38128 60007...      │
│ [ Copiar ]  [ Baixar boleto PDF ]          │
│ Status: ● aguardando pagamento             │
│ ────────────────────────────────────────  │
│ Pago? O envio para análise é automático.   │
└─────────────────────────────────────────────┘
```

## §10 Integrações

- `PagamentoGateway` (interface) → Monetário/banco; implementação real + resiliência em `prd-sial-integracao-resiliencia`.
- Consome a state machine do core (`aguardando_pagamento → enviado_analise`).
- `prd-sial-requerimento`: entrega o processo em `aguardando_pagamento`.

## §11 Faseamento

Fase 1: schema Boleto → PagamentoGateway (stub) → emitir/consultar/reemitir → webhook idempotente + transição → smoke. Boleto apenas; PIX/cartão só se a JUCESP confirmar (G5).

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Webhook duplicado libera análise duas vezes | M | M | Idempotência por `nossoNumero`+status; transição só se ainda em aguardando_pagamento. |
| Compensação nunca chega (banco fora) | M | A | Status visível; polling de fallback; reemissão; alinha com PRD resiliência. |
| Valor incorreto cobrado | B | A | Valor derivado do método/serviço; conferência no emitir; auditável em Evento. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Tempo médio emissão → pago | `SELECT avg("pagoEm"-"createdAt") FROM "Boleto" WHERE status='pago'` |
| Taxa de boletos vencidos | `SELECT count(*) FILTER (WHERE status='vencido')::float/count(*) FROM "Boleto"` |
| Liberação automática pós-pagamento | contador de transições disparadas pelo webhook |

## §14 Open questions

- ❓ (gap G5) Só boleto, ou PIX/cartão? Como o Monetário confirma a compensação? **MVP boleto; mecanismo de webhook a confirmar com a JUCESP.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §6.1, §9, §10.5; `Modelagem_de_Dados_SIAL.md` §3.
- DesignSession card "Geração e pagamento de boleto"; gap G5.

## §16 Stories implementáveis

```yaml
- id: SIAL-PAG-001
  title: Migration — tabela Boleto (+ RLS)
  description: Cria Boleto conforme §7 com CHECK de status, índices e policy de SELECT.
  acceptanceCriteria:
    - "Boleto.status CHECK ('emitido','pago','vencido')"
    - "nossoNumero é UNIQUE"
    - "Policy boleto_select existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename='Boleto'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-PAG-002
  title: PagamentoGateway — interface + stub
  description: Interface emitir(processo)/consultar(nossoNumero) com stub determinístico (gera linhaDigitavel fake). Real em PRD resiliência.
  acceptanceCriteria:
    - "src/lib/sial/pagamento-gateway.ts exporta interface + stub"
    - "Stub gera nossoNumero único e linhaDigitavel"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 20
  touches: ["src/lib/sial/pagamento-gateway.ts"]

- id: SIAL-PAG-003
  title: DAL boleto — emitir, consultar, reemitir
  description: src/lib/sial/dal/boleto.ts. emitir bloqueia se já há boleto pago; reemitir marca vencido o atual e cria novo.
  acceptanceCriteria:
    - "emitir cria Boleto status=emitido"
    - "reemitir marca o anterior como vencido"
    - "não emite se já existe boleto pago no processo"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-PAG-001, SIAL-PAG-002]
  estimateMinutes: 25
  touches: ["src/lib/sial/dal/boleto.ts"]

- id: SIAL-PAG-004
  title: API emitir/consultar/reemitir boleto
  description: POST /api/processos/:id/boleto, GET, POST .../reemitir.
  acceptanceCriteria:
    - "POST retorna 201 com boleto"
    - "POST quando já pago retorna 409"
    - "reemitir retorna novo boleto e marca vencido o antigo"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-PAG-003]
  estimateMinutes: 25
  touches: ["src/app/api/processos/[id]/boleto/route.ts", "src/app/api/processos/[id]/boleto/reemitir/route.ts"]

- id: SIAL-PAG-005
  title: Webhook de pagamento idempotente + transição
  description: POST /api/webhooks/pagamento marca pago e transiciona aguardando_pagamento→enviado_analise; idempotente por nossoNumero.
  acceptanceCriteria:
    - "Chamada repetida não duplica transição"
    - "Só transiciona se processo ainda em aguardando_pagamento"
    - "Boleto.pagoEm preenchido"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-PAG-003]
  estimateMinutes: 30
  touches: ["src/app/api/webhooks/pagamento/route.ts"]

- id: SIAL-PAG-006
  title: Tela de pagamento + regenerar types + smoke
  description: Página com linha digitável/PDF/status; types; smoke: emitir → webhook pago → processo em enviado_analise.
  acceptanceCriteria:
    - "Tela mostra status e linha digitável"
    - "Após webhook, processo fica enviado_analise"
    - "Webhook duplicado não re-transiciona"
  verifiable:
    - kind: sql
      command_or_query: "SELECT status FROM \"Processo\" WHERE id=(SELECT \"processoId\" FROM \"Boleto\" WHERE status='pago' ORDER BY \"pagoEm\" DESC LIMIT 1)"
      expected: "enviado_analise"
  dependsOn: [SIAL-PAG-004, SIAL-PAG-005]
  estimateMinutes: 25
  touches: ["src/app/(portal)/processos/[id]/pagamento/page.tsx", "src/lib/supabase/database.types.ts"]
```

**Total: 6 stories, ~145min (~2h25).**
