# PRD — SIAL Tramitação (tramitar, receber trâmite, áreas)

**Reference**: SIAL-TRM
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (Next.js + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-identity-access`, `prd-sial-analise`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: tramitar = escolher área, assinar, enviar; receber trâmite = analisar, despacho, upload, assinar, tramitar; **bloco genérico recursivo** igual em requerimento e denúncia (doc §6A.4); `area` e `tramite (area_origem, area_destino, status)` (modelagem §3); setores que recebem trâmites e PRORESP (doc §3.3).
- **[decisão-sessão]**: gestão de áreas vive aqui (a tramitação é quem precisa).
- **[inferência]**: schema de `Area`/`Tramite`, caixa de recebidos, paths. A validar.

## Demo/Mock (one-shot)

> **Sem gateway externo.** Áreas/trâmites reais em Supabase; assinatura do trâmite usa o `AssinaturaGateway` mock. Smoke por `scripts/smoke/tramitacao.ts`: tramitar um processo para uma área, a área recebe, cria despacho, devolve — verificado por SQL nas transições/`Tramite`.

## §1 Problema

1. A tramitação entre setores é hoje **manual e sem rastro**; o doc mostra que é o **mesmo bloco** nos fluxos de requerimento e denúncia (doc §6A.4).
2. A tramitação e a decisão da denúncia (PRORESP) dependem de **áreas cadastradas** (modelagem §3; doc §3.3).

## §2 Solução em uma frase

O bloco genérico de **Tramitar** e **Receber Trâmite** entre áreas internas, com cada movimentação registrada em `Tramite`, mais a **gestão de áreas/setores** que a tramitação consome.

## §3 Não-objetivos

- A decisão de **denúncia** (arquivar/PRORESP) — `prd-sial-denuncia-analise` (reusa este bloco).
- Assinatura em si — `prd-sial-assinatura` (aqui acionada).

## §4 Personas e jornada

- **Resolvedor**: "Quero encaminhar o protocolo para a área certa, assinar e enviar; e ver o que chegou para mim de outras áreas."
- **Administrador**: "Quero cadastrar as áreas e quem pertence a cada uma."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | `Area` (nome, ativo) + vínculo `Usuario` (perfil `setor`) à área | [doc] §3.3; modelagem §3 |
| D2 | `Tramite` (processoId, areaOrigem, areaDestino, status, despacho) registra cada movimentação; **recursivo** | [doc] §6A.4; modelagem §3 |
| D3 | Tramitar: `em_analise → tramitado` + cria `Tramite(enviado)`; Receber: área destino vê recebidos | [doc] §6A.4 |
| D4 | Receber trâmite: analisar → despacho → (upload) → assinar → tramitar de volta/adiante | [doc] §6A.4 |
| D5 | Bloco é **genérico** — o mesmo serviço serve requerimento e denúncia | [doc] §6A.6 |

## §6 Arquitetura

```
Admin: CRUD Area + vínculo Usuario↔Area
Resolvedor: POST /api/processos/:id/tramitar { areaDestino, despacho? }
   ├─ Tramite(origem, destino, status=enviado)
   └─ sial_transicao(em_analise → tramitado)
Área destino: GET /api/tramites/recebidos → caixa
   POST /api/tramites/:id/receber { despacho } → analisar/despachar → tramitar de volta/adiante
```

## §7 Schema

```sql
-- 1) <data>_sial_area.sql                          -- [doc §3.3; modelagem §3]
CREATE TABLE "Area" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL UNIQUE,
  ativo boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE "Area" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "area_read" ON "Area" FOR SELECT USING (sial_is_servidor());
CREATE POLICY "area_admin" ON "Area" FOR ALL
  USING (sial_has_perfil('administrador')) WITH CHECK (sial_has_perfil('administrador'));

CREATE TABLE "UsuarioArea" (
  "usuarioId" uuid NOT NULL REFERENCES "Usuario"(id) ON DELETE CASCADE,
  "areaId" uuid NOT NULL REFERENCES "Area"(id) ON DELETE CASCADE,
  PRIMARY KEY ("usuarioId","areaId")
);
ALTER TABLE "UsuarioArea" ENABLE ROW LEVEL SECURITY;
```

```sql
-- 2) <data>_sial_tramite.sql                        -- [doc §6A.4; modelagem §3]
CREATE TABLE "Tramite" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "processoId" uuid NOT NULL REFERENCES "Processo"(id) ON DELETE CASCADE,
  "areaOrigemId" uuid REFERENCES "Area"(id),
  "areaDestinoId" uuid NOT NULL REFERENCES "Area"(id),
  status text NOT NULL DEFAULT 'enviado' CHECK (status IN ('enviado','recebido','devolvido')),
  despacho text,
  "criadoPor" uuid REFERENCES "Usuario"(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "recebidoEm" timestamptz
);
CREATE INDEX "Tramite_processo_idx" ON "Tramite" ("processoId");
CREATE INDEX "Tramite_destino_status_idx" ON "Tramite" ("areaDestinoId", status);
ALTER TABLE "Tramite" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tramite_servidor" ON "Tramite" FOR ALL
  USING (sial_is_servidor()) WITH CHECK (sial_is_servidor());
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| GET/POST | `/api/admin/areas` | (admin) lista/cria área |
| POST | `/api/admin/areas/:id/membros` | (admin) vincula usuário à área |
| POST | `/api/processos/:id/tramitar` | `{areaDestinoId, despacho?}` → cria Tramite + transição → 200 |
| GET | `/api/tramites/recebidos` | (servidor da área) caixa de recebidos |
| POST | `/api/tramites/:id/receber` | `{despacho?, acao:'devolver'|'tramitar', areaDestinoId?}` → 200 |

## §9 UX

```
┌──── Tramitar — protocolo 2026-000123 ──────┐
│ Área destino [ PRORESP ▾ ]                  │
│ Despacho [____________________]             │
│ [ Assinar e enviar ]                        │
└──────────────────────────────────────────────┘
┌──── Trâmites recebidos (minha área) ───────┐
│ 2026-000130  de Análise   [abrir/despachar] │
└──────────────────────────────────────────────┘
```

## §10 Integrações

- Reusado por `prd-sial-denuncia-analise` (tramitar/PRORESP).
- Assinatura do trâmite via `prd-sial-assinatura`.
- Áreas referenciadas pela decisão da denúncia.

## §11 Faseamento

Fase 1: `Area` + `UsuarioArea` → `Tramite` → gestão de áreas (admin) → tramitar → caixa de recebidos + receber/despacho → smoke. Bloco genérico pronto para requerimento e denúncia.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Ciclos infinitos de tramitação | M | M | (gap G11) sem limite no MVP; monitorar; alerta se exceder N saltos. |
| Trâmite para área errada | M | B | Lista de áreas ativas; despacho obrigatório; tudo em Evento. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Trâmites por área destino | `SELECT "areaDestinoId", count(*) FROM "Tramite" GROUP BY 1` |
| Tempo médio enviado→recebido | `SELECT avg("recebidoEm"-"createdAt") FROM "Tramite" WHERE "recebidoEm" IS NOT NULL` |

## §14 Open questions

- ❓ (gap G11) Tramitação tem limite de passos? **Sem limite no MVP; a validar.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §3.3, §6A.4, §6A.6; `Modelagem_de_Dados_SIAL.md` §3.
- DesignSession cards "Tramitação e Receber Trâmite", "Gestão de áreas e setores".

## §16 Stories implementáveis

```yaml
- id: SIAL-TRM-001
  title: Migration — Area + UsuarioArea (+ RLS)
  description: Cria Area e UsuarioArea conforme §7 (1) com policies admin/servidor.
  acceptanceCriteria:
    - "Area.nome UNIQUE; policy area_admin (admin) existe"
    - "UsuarioArea PK composta"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename='Area'"
      expected: "2"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-TRM-002
  title: Migration — Tramite (+ RLS, índices)
  description: Cria Tramite conforme §7 (2) com CHECK de status e índices.
  acceptanceCriteria:
    - "Tramite.status CHECK ('enviado','recebido','devolvido')"
    - "Índice Tramite_destino_status_idx existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_indexes WHERE indexname='Tramite_destino_status_idx'"
      expected: "1"
  dependsOn: [SIAL-TRM-001]
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-TRM-003
  title: Gestão de áreas (admin API)
  description: GET/POST /api/admin/areas e POST membros; só administrador.
  acceptanceCriteria:
    - "Admin cria área e vincula membro"
    - "Não-admin recebe 403"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-TRM-001]
  estimateMinutes: 25
  touches: ["src/app/api/admin/areas/route.ts", "src/app/api/admin/areas/[id]/membros/route.ts"]

- id: SIAL-TRM-004
  title: DAL + API tramitar
  description: src/lib/sial/dal/tramite.ts + POST /api/processos/:id/tramitar (cria Tramite + transição em_analise→tramitado).
  acceptanceCriteria:
    - "Tramitar cria Tramite(enviado) e transiciona"
    - "Área destino inválida/inativa retorna 422"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-TRM-002]
  estimateMinutes: 30
  touches: ["src/lib/sial/dal/tramite.ts", "src/app/api/processos/[id]/tramitar/route.ts"]

- id: SIAL-TRM-005
  title: Caixa de recebidos + receber/despacho (API + UI)
  description: GET /api/tramites/recebidos, POST /api/tramites/:id/receber; tela de caixa + despacho.
  acceptanceCriteria:
    - "Caixa lista trâmites da área do usuário",
    - "Receber grava despacho e marca recebido",
    - "Tramitar de volta/adiante cria novo Tramite"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-TRM-004]
  estimateMinutes: 30
  touches: ["src/app/api/tramites/recebidos/route.ts", "src/app/api/tramites/[id]/receber/route.ts", "src/app/(backoffice)/tramites/page.tsx"]

- id: SIAL-TRM-006
  title: Smoke — tramitação ida e volta
  description: scripts/smoke/tramitacao.ts tramita para uma área, recebe, despacha e devolve.
  acceptanceCriteria:
    - "Tramite registrado enviado→recebido",
    - "Processo passa por tramitado",
    - "Despacho persistido"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"Tramite\" WHERE status IN ('recebido','devolvido')"
      expected: ">=1"
  dependsOn: [SIAL-TRM-005]
  estimateMinutes: 25
  touches: ["scripts/smoke/tramitacao.ts"]
```

**Total: 6 stories, ~150min (~2h30).**
