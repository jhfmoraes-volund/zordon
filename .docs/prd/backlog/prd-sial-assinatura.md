# PRD — SIAL Assinatura (gov.br/certificado, coautoria e fila)

**Reference**: SIAL-ASS
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (React + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-identity-access`, `prd-sial-documentos`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: assinatura via gov.br (grátis) ou certificado A1/A3 — e-CPF/e-CNPJ (doc §5); módulo de assinaturas com fila de pendências por usuário (RF05, doc §4); vincular assinante antes do envio (doc §6.1 passo 5); `assinatura: documento_id, assinante_id, tipo (govbr/certificado_a1/a3), hash, assinado_em` (modelagem §3).
- **[doc/gap]**: coautoria — um processo pode ter mais de um assinante (gap G10 / modelagem §11.4).
- **[inferência]**: `DocumentoAssinante` como controle de pendência, `AssinaturaGateway`, regra de conclusão (todos assinaram), carimbo de tempo, paths. A validar.

## Demo/Mock (one-shot)

> Roda em **mock-mode**. O `AssinaturaGateway` vem de `getGateways()`: stub assina (gera `hash` determinístico) validando `nivelGovbr` no caminho gov.br, sem chamar gov.br/certificadora reais. Coautoria e fila são reais em Supabase. Smoke por `scripts/smoke/assinatura.ts`: documento com 2 assinantes só conclui após ambos. APIs gov.br/ICP-Brasil reais = Track B, mesma interface.

## §1 Problema

1. A assinatura é etapa **obrigatória** e precisa atender quem usa **gov.br** e quem usa **certificado próprio A1/A3** (doc §5).
2. As assinaturas pendentes ficam **espalhadas** pelo sistema; falta uma **fila única** por usuário (RF05, doc §4).
3. Um documento pode exigir **mais de um assinante** (coautoria); o envio só pode seguir quando todos assinaram (doc §6.1 passo 5; gap G10).

## §2 Solução em uma frase

Assina os documentos do processo por gov.br ou certificado A1/A3, controla a **coautoria** (todos os assinantes vinculados) e oferece uma **fila de pendências** por usuário.

## §3 Não-objetivos

- Identidade/login gov.br — `prd-sial-identity-access` (aqui consumimos `nivelGovbr`).
- Geração/armazenamento do documento — `prd-sial-documentos`.
- Integração resiliente com certificadoras — interface aqui; resiliência em `prd-sial-integracao-resiliencia`.

## §4 Personas e jornada

- **Requerente**: "Quero assinar de graça pelo gov.br, ou com meu e-CNPJ, e quando há coautor, que o sistema espere todos antes de enviar."
- **Resolvedor**: "Quero uma fila com tudo que preciso assinar, e assinar em sequência."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | `Assinatura.tipo` ∈ `govbr`/`certificado_a1`/`certificado_a3`; guarda `hash` + `assinadoEm` | [doc] §5; modelagem §3 |
| D2 | `DocumentoAssinante` controla quem deve assinar e o status; **coautoria = N assinantes/documento** | [doc] §6.1 p5; [gap G10] |
| D3 | Documento só conta como assinado quando **todas** as pendências estão assinadas | [inferência] |
| D4 | gov.br exige `nivelGovbr` mínimo (prata/ouro) para assinar; senão orienta certificado | [doc] §5 (assinatura gov.br); [inferência] no nível exato |
| D5 | `AssinaturaGateway` com dois caminhos (gov.br, certificado) atrás de interface | [decisão-sessão] + [inferência] |
| D6 | Fila de pendências por usuário (RF05) com assinatura individual e em lote | [doc] §4 (RF05); [inferência] no lote |

## §6 Arquitetura

```
Documento ──1:N──► DocumentoAssinante(usuarioId, status pendente/assinado)
                        │ POST /api/documentos/:id/assinar { caminho }
                        ▼
                 AssinaturaGateway
                   ├─ govbr: valida nivelGovbr + APIs gov.br
                   └─ certificado: identifica A1/A3 (e-CPF/e-CNPJ)
                        ▼ cria Assinatura(hash, assinadoEm) + marca pendência assinada
                 (todos assinaram?) → Documento pronto

Fila: GET /api/assinaturas/pendentes → DocumentoAssinante WHERE usuario=eu AND status=pendente
```

## §7 Schema

```sql
-- 1) <data>_sial_documento_assinante.sql          -- [doc §6.1 p5]+[gap G10]; [inferência] modelagem
CREATE TABLE "DocumentoAssinante" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "documentoId" uuid NOT NULL REFERENCES "Documento"(id) ON DELETE CASCADE,
  "usuarioId" uuid NOT NULL REFERENCES "Usuario"(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','assinado')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("documentoId","usuarioId")
);
CREATE INDEX "DocAssinante_usuario_pendente_idx" ON "DocumentoAssinante" ("usuarioId", status);
ALTER TABLE "DocumentoAssinante" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "doc_assinante_self" ON "DocumentoAssinante" FOR SELECT
  USING ("usuarioId"=sial_current_usuario() OR sial_is_servidor());
```

```sql
-- 2) <data>_sial_assinatura.sql                    -- [doc §5; modelagem §3]
CREATE TABLE "Assinatura" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "documentoId" uuid NOT NULL REFERENCES "Documento"(id) ON DELETE CASCADE,
  "assinanteId" uuid NOT NULL REFERENCES "Usuario"(id),
  tipo text NOT NULL CHECK (tipo IN ('govbr','certificado_a1','certificado_a3')),
  hash text NOT NULL,
  "assinadoEm" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "Assinatura_documento_idx" ON "Assinatura" ("documentoId");
ALTER TABLE "Assinatura" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assinatura_select" ON "Assinatura" FOR SELECT USING (EXISTS (
  SELECT 1 FROM "Documento" d JOIN "Processo" p ON p.id=d."processoId"
  WHERE d.id="documentoId" AND (p."requerenteId"=sial_current_usuario() OR sial_is_servidor())));
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| POST | `/api/documentos/:id/assinantes` | `{usuarioId}` → vincula assinante (pendente) → 201 |
| POST | `/api/documentos/:id/assinar` | `{caminho:'govbr'|'certificado_a1'|'certificado_a3'}` → AssinaturaGateway → cria Assinatura + marca pendência → 200; 412 se nivelGovbr insuficiente |
| GET | `/api/documentos/:id/assinaturas` | → assinantes + status + assinaturas |
| GET | `/api/assinaturas/pendentes` | (fila do usuário) → documentos pendentes de assinatura |
| POST | `/api/assinaturas/lote` | `{documentoIds[], caminho}` → assina em lote → 200 |

## §9 UX

```
┌──── Fila de assinaturas ──────────────────────┐
│ ☐ Requerimento — protocolo 2026-000123        │
│ ☐ Termo de compromisso — 2026-000124          │
│ ───────────────────────────────────────────── │
│ Assinar com:  (●) gov.br   ( ) certificado     │
│ [ Assinar selecionados ]                       │
└─────────────────────────────────────────────────┘
```

## §10 Integrações

- `AssinaturaGateway` → APIs gov.br (assinatura) e entidades certificadoras (A1/A3); resiliência em `prd-sial-integracao-resiliencia`.
- Consome `Usuario.nivelGovbr` de `prd-sial-identity-access`.
- Assina `Documento` de `prd-sial-documentos`.
- `prd-sial-requerimento`/`prd-sial-exigencia`: gate de envio/reenvio depende de assinatura concluída.

## §11 Faseamento

Fase 1: schema (2 tabelas) → AssinaturaGateway (stub gov.br/cert) → vincular assinante → assinar + regra de conclusão (coautoria) → fila de pendências + lote → smoke.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Certificadora/gov.br indisponível na hora de assinar | M | A | Mensagem clara + retry; alinha com PRD resiliência. |
| Coautoria trava envio se um assinante some | M | M | Status visível por assinante; possibilidade de remover/trocar assinante (com auditoria). |
| Nível gov.br insuficiente descoberto tarde | M | B | Validar nivelGovbr cedo (412) e orientar certificado. |
| Validade jurídica do hash/carimbo | M | A | Seguir padrões ICP-Brasil; carimbo de tempo confiável. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Assinaturas por tipo | `SELECT tipo, count(*) FROM "Assinatura" GROUP BY 1` |
| Documentos com coautoria | `SELECT count(*) FROM (SELECT "documentoId" FROM "DocumentoAssinante" GROUP BY 1 HAVING count(*)>1) x` |
| Tempo médio pendente → assinado | derivado de DocumentoAssinante.createdAt vs Assinatura.assinadoEm |

## §14 Open questions

- ❓ (gap G10) Coautoria confirmada? **Modelado N:N; validar regras (todos obrigatórios?).**
- ❓ Nível gov.br mínimo para assinar (prata? ouro?). **Assumido prata+; confirmar.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §4 (RF05), §5, §6.1; `Modelagem_de_Dados_SIAL.md` §3, §11.4.
- DesignSession cards "Assinatura digital", "Vinculação de assinante e coautoria", "Módulo de Assinaturas".

## §16 Stories implementáveis

```yaml
- id: SIAL-ASS-001
  title: Migration — DocumentoAssinante (+ RLS, UNIQUE)
  description: Cria DocumentoAssinante conforme §7 (1) com UNIQUE (documentoId, usuarioId) e policy.
  acceptanceCriteria:
    - "UNIQUE (documentoId, usuarioId)"
    - "status CHECK ('pendente','assinado')"
    - "Policy doc_assinante_self existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename='DocumentoAssinante'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-ASS-002
  title: Migration — Assinatura (+ RLS)
  description: Cria Assinatura conforme §7 (2) com CHECK de tipo e policy.
  acceptanceCriteria:
    - "tipo CHECK ('govbr','certificado_a1','certificado_a3')"
    - "hash NOT NULL"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM information_schema.columns WHERE table_name='Assinatura' AND column_name='hash'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 15
  touches: ["supabase/migrations/"]

- id: SIAL-ASS-003
  title: AssinaturaGateway — gov.br + certificado (stub)
  description: src/lib/sial/assinatura-gateway.ts com assinar(caminho, documento, usuario) → {hash}. Stub valida nivelGovbr para o caminho gov.br.
  acceptanceCriteria:
    - "Caminho govbr rejeita nivelGovbr insuficiente"
    - "Caminho certificado_a1/a3 retorna hash determinístico (stub)"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 25
  touches: ["src/lib/sial/assinatura-gateway.ts"]

- id: SIAL-ASS-004
  title: API vincular assinante + assinar (regra de conclusão)
  description: POST assinantes, POST assinar (cria Assinatura, marca pendência; quando todas assinadas, documento pronto).
  acceptanceCriteria:
    - "Vincular cria pendência",
    - "Assinar com nivel insuficiente retorna 412",
    - "Última assinatura marca o documento como totalmente assinado"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-ASS-001, SIAL-ASS-002, SIAL-ASS-003]
  estimateMinutes: 30
  touches: ["src/app/api/documentos/[id]/assinantes/route.ts", "src/app/api/documentos/[id]/assinar/route.ts"]

- id: SIAL-ASS-005
  title: Fila de pendências + assinatura em lote (API + UI)
  description: GET /api/assinaturas/pendentes, POST /api/assinaturas/lote, e a tela de fila.
  acceptanceCriteria:
    - "Fila lista só pendências do usuário logado",
    - "Lote assina múltiplos com o mesmo caminho",
    - "RLS impede ver pendência de outro usuário"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-ASS-004]
  estimateMinutes: 30
  touches: ["src/app/api/assinaturas/pendentes/route.ts", "src/app/api/assinaturas/lote/route.ts", "src/components/sial/fila-assinaturas.tsx"]

- id: SIAL-ASS-006
  title: Regenerar types + smoke (coautoria)
  description: Types; smoke com documento de 2 assinantes — só conclui quando ambos assinam.
  acceptanceCriteria:
    - "Documento com 2 assinantes não conclui com 1 assinatura",
    - "Após a 2ª assinatura, documento fica totalmente assinado"
  verifiable:
    - kind: manual_browser
      command_or_query: "Vincular 2 assinantes; assinar com cada um; observar conclusão"
      expected: "conclui só após ambos" 
  dependsOn: [SIAL-ASS-005]
  estimateMinutes: 25
  touches: ["src/lib/supabase/database.types.ts", "(end-to-end)"]
```

**Total: 6 stories, ~145min (~2h25).**
