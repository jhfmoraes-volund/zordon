# PRD — SIAL Notificações (multicanal + central no portal)

**Reference**: SIAL-NOT
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (Next.js + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-identity-access`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: avisar o requerente de exigência, deferimento e demais mudanças (doc §6.1 passo 12); `notificacao (destinatario_id, processo_id, canal email/portal/govbr, conteudo, enviado_em)` (modelagem §3).
- **[decisão-sessão]**: implementa o `NotificacaoService` (interface usada por deferir/exigência/SLA/denúncia); canal **portal** (in-app) é real, e-mail/gov.br via gateway mock.
- **[inferência]**: templates, central de notificações, preferências, paths. A validar (gap G6 — canais).

## Demo/Mock (one-shot)

> Roda em **mock-mode**. Canal **portal** (in-app, Supabase) é real; canais **email/gov.br** usam `NotificacaoGateway` mock (registra o envio sem mandar de verdade). Smoke por `scripts/smoke/notificacoes.ts`: um deferimento dispara notificação que aparece na central do requerente (SQL).

## §1 Problema

1. O requerente precisa ser **avisado** de exigência e deferimento; sem isso, depende de lembrar de checar (doc §6.1 passo 12).
2. As notificações são **disparadas de vários pontos** (deferir, exigência, SLA, denúncia) e hoje não têm um canal único.

## §2 Solução em uma frase

Implementa o `NotificacaoService` que registra e entrega notificações **multicanal** (portal in-app real; e-mail/gov.br via gateway), com **central no portal** e templates por evento.

## §3 Não-objetivos

- Provedor real de e-mail/gov.br — Track B (gateway mock aqui).
- Os gatilhos em si — vêm dos PRDs que chamam `NotificacaoService` (deferir, exigência, SLA, denúncia).

## §4 Personas e jornada

- **Requerente**: "Quero ver num lugar só os avisos do meu pedido (exigência, deferimento) e ser levado à ação."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | `Notificacao (destinatarioId, processoId, canal, conteudo, lida, enviadoEm)` | [doc] modelagem §3 |
| D2 | Canal `portal` (in-app) é **real**; `email`/`govbr` via `NotificacaoGateway` (mock no Track A) | [decisão-sessão]; gap G6 |
| D3 | `NotificacaoService.notificar(evento)` resolve template + destinatário + canal | [doc] §6.1 p12 |
| D4 | Templates por tipo de evento (exigencia, deferimento, tramitacao…) | [inferência] |
| D5 | Central no portal lista e marca como lida; aponta para a tela de ação | [inferência] |

## §6 Arquitetura

```
deferir / exigência / SLA / denúncia → NotificacaoService.notificar({tipo, processo, destinatario})
   ├─ resolve template(tipo)
   ├─ canal portal → INSERT Notificacao (lida=false)         [real]
   └─ canal email/govbr → NotificacaoGateway.enviar()         [mock]
Central: GET /api/notificacoes (requerente) · POST :id/lida
```

## §7 Schema

```sql
-- 1) <data>_sial_notificacao.sql                   -- [doc modelagem §3]
CREATE TABLE "Notificacao" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "destinatarioId" uuid NOT NULL REFERENCES "Usuario"(id) ON DELETE CASCADE,
  "processoId" uuid REFERENCES "Processo"(id) ON DELETE CASCADE,
  tipo text NOT NULL,                                -- 'exigencia','deferimento',...
  canal text NOT NULL CHECK (canal IN ('portal','email','govbr')),
  conteudo text NOT NULL,
  lida boolean NOT NULL DEFAULT false,
  "enviadoEm" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "Notificacao_destinatario_idx" ON "Notificacao" ("destinatarioId", lida);
ALTER TABLE "Notificacao" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notificacao_self" ON "Notificacao" FOR ALL
  USING ("destinatarioId" = sial_current_usuario())
  WITH CHECK ("destinatarioId" = sial_current_usuario());
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| GET | `/api/notificacoes` | (usuário) lista as suas (não lidas primeiro) |
| POST | `/api/notificacoes/:id/lida` | marca como lida → 204 |
| (interno) | `NotificacaoService.notificar(...)` | usado pelos demais PRDs |

## §9 UX

```
┌──── Notificações ─────────────────────────────┐
│ ● Exigência no protocolo 2026-000123  [abrir]  │
│ ● Documento deferido — 2026-000120    [abrir]  │
│   Tramitado para PRORESP — 2026-000130          │
└─────────────────────────────────────────────────┘
```

## §10 Integrações

- Implementa o `NotificacaoService` consumido por `prd-sial-decisao-deferir`, `prd-sial-exigencia`, `prd-sial-analise-gestao` (SLA) e `prd-sial-denuncia-analise`.
- `NotificacaoGateway` (email/gov.br) real = Track B.
- Central roda no `(portal)` do app-shell.

## §11 Faseamento

Fase 1: schema `Notificacao` → `NotificacaoService` + templates + canal portal → `NotificacaoGateway` (mock) → central no portal → liga aos gatilhos existentes → smoke.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Excesso de notificações | M | B | Agrupar por processo; preferências (futuro). |
| Notificação vazar dado sensível | B | M | Conteúdo mínimo; detalhe só após login na tela de ação. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Notificações por tipo/canal | `SELECT tipo, canal, count(*) FROM "Notificacao" GROUP BY 1,2` |
| Taxa de leitura | `SELECT count(*) FILTER (WHERE lida)::float/count(*) FROM "Notificacao"` |

## §14 Open questions

- ❓ (gap G6) Por quais canais avisar (e-mail/portal/gov.br)? Preferência configurável? **MVP portal real + email/govbr mock; validar.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §6.1; `Modelagem_de_Dados_SIAL.md` §3.
- DesignSession card "Notificações ao requerente"; gap G6.

## §16 Stories implementáveis

```yaml
- id: SIAL-NOT-001
  title: Migration — tabela Notificacao (+ RLS)
  description: Cria Notificacao conforme §7 com CHECK de canal e policy do dono.
  acceptanceCriteria:
    - "canal CHECK ('portal','email','govbr')"
    - "Policy notificacao_self existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename='Notificacao'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-NOT-002
  title: NotificacaoGateway (email/govbr) — interface + stub
  description: src/lib/sial/gateways/notificacao-gateway.ts (registra envio sem mandar). Real em Track B.
  acceptanceCriteria:
    - "enviar(canal, destino, conteudo) registra e retorna ok",
    - "Disponível via getGateways()"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 20
  touches: ["src/lib/sial/gateways/notificacao-gateway.ts"]

- id: SIAL-NOT-003
  title: NotificacaoService + templates (impl)
  description: src/lib/sial/services/notificacao-impl.ts resolve template+canal; portal=INSERT, email/govbr=gateway. Registra como impl do NotificacaoService.
  acceptanceCriteria:
    - "notificar(tipo, processo, destinatario) cria Notificacao(portal)",
    - "Canais email/govbr passam pelo gateway",
    - "Templates por tipo (exigencia/deferimento/tramitacao)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-NOT-001, SIAL-NOT-002]
  estimateMinutes: 30
  touches: ["src/lib/sial/services/notificacao-impl.ts", "src/lib/sial/services/notificacao.ts"]

- id: SIAL-NOT-004
  title: Central de notificações (API + UI)
  description: GET /api/notificacoes, POST /:id/lida e a central no portal (badge + lista).
  acceptanceCriteria:
    - "Lista as do usuário, não lidas primeiro",
    - "Marcar como lida funciona",
    - "Item leva à tela de ação"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-NOT-003]
  estimateMinutes: 30
  touches: ["src/app/api/notificacoes/route.ts", "src/app/api/notificacoes/[id]/lida/route.ts", "src/components/sial/central-notificacoes.tsx"]

- id: SIAL-NOT-005
  title: Smoke — notificação no deferimento
  description: scripts/smoke/notificacoes.ts defere um processo e confere a notificação na central do requerente.
  acceptanceCriteria:
    - "Deferimento gera Notificacao(portal) ao requerente",
    - "Central retorna a notificação não lida"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"Notificacao\" WHERE tipo='deferimento'"
      expected: ">=1"
  dependsOn: [SIAL-NOT-004]
  estimateMinutes: 20
  touches: ["scripts/smoke/notificacoes.ts"]
```

**Total: 5 stories, ~120min (~2h).**
