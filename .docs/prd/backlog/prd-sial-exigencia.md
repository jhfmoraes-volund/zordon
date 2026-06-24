# PRD — SIAL Exigência (loop de devolução e correção)

**Reference**: SIAL-EXIG
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (React + Supabase + GCP)
**Depende de**: `prd-sial-core-process`, `prd-sial-requerimento`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: exigência como momento crítico de UX e reaproveitamento de dados (doc §6.1 nota, §6A.4), `exigencia` com status aberta/sanada (modelagem §3), volta ao início da análise após reajuste (modelagem §4).
- **[inferência]**: `descricaoErros` estruturado por campo, UNIQUE parcial de uma aberta, FK `analiseId` adiada, código 422 no sanar, paths de API. A validar com a JUCESP.

## Demo/Mock (one-shot)

> **Sem gateway externo** — loop puro em Supabase. Smoke 100% automatizável por `scripts/smoke/exigencia.ts` (`npm run smoke exigencia`): resolvedor abre exigência (`em_analise→em_exigencia`), requerente corrige dados e sana (`em_exigencia→enviado_analise`), tudo verificado por SQL. Personas via dev-auth.

## §1 Problema

1. A exigência é o **momento de maior atrito de UX**: o requerente é devolvido e, se mal tratado, abandona ou reclama (doc §6.1 nota crítica, §6A.4).
2. **Exigências vagas** geram reenvios errados e mais retrabalho dos dois lados (risco R6 da DS).
3. Sem reaproveitar os dados já preenchidos, o requerente refaz tudo do zero ao corrigir.

## §2 Solução em uma frase

O loop de exigência: o analista devolve o protocolo com **erros estruturados por campo**, e o requerente corrige reaproveitando os dados, reassina e reenvia — voltando ao início da fila de análise.

## §3 Não-objetivos

- A **decisão completa** do analista (deferir/tramitar) — `prd-sial-decisao-deferir` e `prd-sial-tramitacao`. Aqui só a saída **exigência** do gateway.
- A **reassinatura** em si — mecanismo em `prd-sial-assinatura`; aqui o loop apenas a aciona.
- A tela completa de análise — `prd-sial-analise`. Aqui só a ação de abrir exigência.

## §4 Personas e jornada

- **Resolvedor**: "Quero devolver apontando exatamente o que está errado, sem texto solto, pra não voltar de novo."
- **Requerente**: "Quero ver o que preciso corrigir, ajustar só aquilo e reenviar sem refazer o formulário inteiro."

## §5 Decisões fixadas

| Dn | Decisão | Por quê |
|----|---------|---------|
| D1 | `Exigencia.descricaoErros` é **estruturada** (array `{campo, problema, orientacao}`), não texto livre | Doc §6.1 pede "mensagem clara do que está errado"; estrutura reduz reenvio errado (R6). |
| D2 | Abrir exigência: `em_analise → em_exigencia`; reenviar: `em_exigencia → enviado_analise` | Modelagem §4 (volta ao começo da análise após reajuste). Via `sial_transicao`. |
| D3 | `Exigencia` referencia `processoId` (obrigatório) + `analiseId` (nullable, **FK adicionada em `prd-sial-analise`**) | A entidade Analise vem depois; mesmo padrão de FK adiada do core. |
| D4 | Correção **reaproveita** `Processo.dados` (não zera o formulário) | Doc §6.1: "reaproveitamento dos dados já preenchidos". |
| D5 | `Exigencia.status` ∈ aberta/sanada; só uma aberta por processo por vez | Modelagem §3; evita ambiguidade no reenvio. |

## §6 Arquitetura

```
[Resolvedor] na análise
   │ POST /api/processos/:id/exigencia { erros:[{campo,problema,orientacao}] }
   ├─ cria Exigencia(status=aberta)
   └─ sial_transicao(em_analise → em_exigencia)  ──► notificação ao requerente
                                                       (PRD notificações)
[Requerente] vê exigência
   │ edita Processo.dados (reaproveitando) ──► PUT /api/requerimentos/:id
   │ (reassina — PRD assinatura)
   │ POST /api/exigencias/:id/sanar
   ├─ Exigencia.status = sanada
   └─ sial_transicao(em_exigencia → enviado_analise)
```

## §7 Schema

```sql
-- 1) <data>_sial_exigencia.sql
CREATE TABLE "Exigencia" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "processoId" uuid NOT NULL REFERENCES "Processo"(id) ON DELETE CASCADE,
  "analiseId" uuid,                          -- FK p/ Analise adicionada em SIAL-ANALISE
  "descricaoErros" jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{campo, problema, orientacao}]
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','sanada')),
  "criadaPor" uuid REFERENCES "Usuario"(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "sanadaEm" timestamptz
);
CREATE INDEX "Exigencia_processo_idx" ON "Exigencia" ("processoId", status);
-- no máximo uma exigência aberta por processo
CREATE UNIQUE INDEX "Exigencia_uma_aberta" ON "Exigencia" ("processoId")
  WHERE status = 'aberta';
ALTER TABLE "Exigencia" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exigencia_select" ON "Exigencia" FOR SELECT USING (EXISTS (
  SELECT 1 FROM "Processo" p WHERE p.id="processoId"
    AND (p."requerenteId"=sial_current_usuario() OR sial_is_servidor())));
CREATE POLICY "exigencia_abrir" ON "Exigencia" FOR INSERT
  WITH CHECK (sial_has_perfil('resolvedor'));
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| POST | `/api/processos/:id/exigencia` | (resolvedor) `{erros:[{campo,problema,orientacao}]}` → cria Exigencia + transição → 201; 409 se já há aberta |
| GET | `/api/processos/:id/exigencia` | → exigência aberta (ou histórico) |
| POST | `/api/exigencias/:id/sanar` | (requerente, dono) → marca sanada + transição `em_exigencia → enviado_analise` → 200; 422 se ainda houver campo apontado sem alteração |

## §9 UX

### Requerente — tela de exigência
```
┌──── Exigência — protocolo 2026-000123 ─────────────┐
│ Seu pedido foi devolvido para correção:             │
│                                                     │
│ • Campo "Período"  — Data final anterior à inicial  │
│     → Ajuste para o período correto do livro        │
│ • Campo "Folhas"   — Número não confere com o anexo │
│     → Informe o total de folhas do livro            │
│ ─────────────────────────────────────────────────  │
│ [ Corrigir dados ]  (abre o formulário preenchido)  │
└─────────────────────────────────────────────────────┘
```

## §10 Integrações

- `prd-sial-analise`: a tela de decisão chama POST exigência; adiciona FK `analiseId`.
- `prd-sial-requerimento`: a correção reusa `PUT /api/requerimentos/:id` (dados preservados).
- `prd-sial-assinatura`: reassinatura antes do reenvio.
- `prd-sial-notificacoes`: dispara aviso de exigência ao requerente.

## §11 Faseamento

Fase 1: schema Exigencia → abrir (resolvedor) → ver (requerente) → sanar/reenviar → smoke do loop. A reassinatura é acoplada quando `prd-sial-assinatura` existir; até lá, o reenvio segue sem o passo de assinatura.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Exigência vaga → reenvio errado | A | M (R6) | Erros estruturados por campo (D1); orientação obrigatória por item. |
| Duas exigências abertas simultâneas | B | M | UNIQUE parcial (uma aberta por processo). |
| Requerente reenvia sem corrigir nada | M | B | `sanar` confere que houve alteração nos campos apontados; senão 422. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Reincidência de exigência (mesmo processo) | `SELECT "processoId", count(*) FROM "Exigencia" GROUP BY 1 HAVING count(*)>1` |
| Tempo médio aberta → sanada | `SELECT avg("sanadaEm"-"createdAt") FROM "Exigencia" WHERE status='sanada'` |
| % processos que passam por exigência | `SELECT count(DISTINCT "processoId")::float/(SELECT count(*) FROM "Processo" WHERE tipo='requerimento') FROM "Exigencia"` |

## §14 Open questions

- ❓ Limite de ciclos de exigência por processo? **Não definido no doc; sem limite no MVP, monitorar reincidência.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §6.1 (nota crítica), §6A.4; `Modelagem_de_Dados_SIAL.md` §3, §4.
- DesignSession cards "Responder exigência", "Decisão: Exigência"; risco R6.

## §16 Stories implementáveis

```yaml
- id: SIAL-EXIG-001
  title: Migration — tabela Exigencia (+ UNIQUE parcial + RLS)
  description: Cria Exigencia conforme §7 com descricaoErros jsonb, UNIQUE parcial de uma aberta por processo e policies.
  acceptanceCriteria:
    - "Exigencia.status CHECK ('aberta','sanada')"
    - "Índice UNIQUE parcial Exigencia_uma_aberta existe"
    - "Policies exigencia_select e exigencia_abrir existem"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_indexes WHERE indexname='Exigencia_uma_aberta'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 25
  touches: ["supabase/migrations/"]

- id: SIAL-EXIG-002
  title: DAL exigencia — abrir, getAberta, sanar
  description: src/lib/sial/dal/exigencia.ts. abrir cria + transiciona em_analise→em_exigencia; sanar marca sanada + transiciona em_exigencia→enviado_analise.
  acceptanceCriteria:
    - "abrir falha se já há exigência aberta (409 na API)"
    - "sanar exige que campos apontados tenham mudado"
    - "ambos passam por sial_transicao"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-EXIG-001]
  estimateMinutes: 30
  touches: ["src/lib/sial/dal/exigencia.ts"]

- id: SIAL-EXIG-003
  title: API abrir exigência (resolvedor)
  description: POST /api/processos/:id/exigencia com erros estruturados; valida perfil resolvedor.
  acceptanceCriteria:
    - "Cria Exigencia e transiciona para em_exigencia"
    - "Não-resolvedor recebe 403"
    - "Segunda exigência aberta retorna 409"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-EXIG-002]
  estimateMinutes: 25
  touches: ["src/app/api/processos/[id]/exigencia/route.ts"]

- id: SIAL-EXIG-004
  title: API sanar exigência (requerente)
  description: POST /api/exigencias/:id/sanar; só o dono do processo; transiciona para enviado_analise.
  acceptanceCriteria:
    - "Dono sana e processo volta a enviado_analise"
    - "Sem alteração nos campos apontados retorna 422"
    - "Não-dono recebe 403"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-EXIG-002]
  estimateMinutes: 25
  touches: ["src/app/api/exigencias/[id]/sanar/route.ts"]

- id: SIAL-EXIG-005
  title: Tela de exigência (requerente) + types + smoke
  description: Tela listando erros estruturados com atalho para corrigir; regenera types; smoke do loop completo.
  acceptanceCriteria:
    - "Tela mostra cada erro com campo/problema/orientação"
    - "Botão Corrigir abre o formulário com dados preservados"
    - "Smoke: abrir → corrigir → sanar volta a enviado_analise"
  verifiable:
    - kind: manual_browser
      command_or_query: "Resolvedor abre exigência; requerente corrige e reenvia"
      expected: "processo volta a enviado_analise, dados preservados"
  dependsOn: [SIAL-EXIG-003, SIAL-EXIG-004]
  estimateMinutes: 30
  touches: ["src/app/(portal)/processos/[id]/exigencia/page.tsx", "src/lib/supabase/database.types.ts"]
```

**Total: 5 stories, ~135min (~2h15).**
