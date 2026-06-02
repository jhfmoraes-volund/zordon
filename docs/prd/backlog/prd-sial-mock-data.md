# PRD — SIAL Mock Data (seed da demo)

**Reference**: SIAL-MOCK
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (Next.js + Supabase + GCP)
**Depende de**: todo o Track A (entidades existentes) — em especial `prd-sial-core-process`, `prd-sial-identity-access`, `prd-sial-requerimento`, `prd-sial-decisao-deferir`, `prd-sial-denuncia-cadastro`, `prd-sial-tramitacao`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[decisão-sessão]**: meta é **demo 1-shot que mostra como funciona** — telas precisam nascer populadas. Este PRD é o **fechamento do Track A**.
- **[inferência]**: volumes, nomes fictícios, distribuição por status. Dados são **sintéticos** (não reais da JUCESP).

## Demo/Mock (one-shot)

> **Sem gateway externo.** Seed idempotente (UUIDs fixos / `ON CONFLICT DO NOTHING`) que popula todas as entidades. Reexecutável sem duplicar. Smoke por `scripts/smoke/mock-data.ts`: confere contagens mínimas por entidade e que há autenticações publicadas (para validação pública) e processos em todos os status.

## §1 Problema

1. Sem dados, a demo abre **telas vazias** e não "mostra como funciona".
2. As personas precisam de um estado realista: processos em **todos os status**, documentos, exigências, denúncias, trâmites e autenticações publicadas.

## §2 Solução em uma frase

Um seed idempotente que popula usuários (5 personas), áreas, métodos, cadastros, ~20 processos em todos os status (com documentos, assinaturas, exigências, análises, trâmites), denúncias e autenticações publicadas — para a demo abrir cheia e navegável.

## §3 Não-objetivos

- Dados reais da JUCESP — tudo **sintético**.
- Performance/volume de produção — seed é pequeno (demo).

## §4 Personas e jornada

- **Avaliador da demo**: "Quero entrar como cada persona e já ver filas, processos, documentos e validações funcionando."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | Seed **idempotente** (UUIDs fixos + ON CONFLICT) — reexecutável | [inferência] |
| D2 | 5 usuários (requerente, leiloeiro, tradutor, resolvedor, administrador) mapeados ao dev-auth | [decisão-sessão] |
| D3 | ~20 processos cobrindo **todos os status** do enum (incl. deferido publicado, em_exigencia, tramitado, denúncia em vários estados) | [decisão-sessão] |
| D4 | Áreas (incl. **PRORESP**) e métodos (livro/leiloeiro/tradutor) garantidos | [doc] §3.3 |
| D5 | Pelo menos 3 autenticações **publicadas** com código (para validação pública e diretório) | [doc] §6.4 |
| D6 | Roda via migration/script dedicado, atrás de guarda `SIAL_MOCK`/ambiente não-produção | [decisão-sessão] |

## §6 Arquitetura

```
scripts/seed/mock-data.ts (ou migration seed)
  → Usuario x5 (+ UsuarioPerfil)         → Area x N (PRORESP, Setor A…)
  → Metodo (livro/leiloeiro/tradutor)    → Cadastro (empresas/leiloeiros/tradutores)
  → Processo x~20 (todos os status) + Protocolo
     ├─ Documento + Assinatura           ├─ Exigencia (algumas abertas/sanadas)
     ├─ Analise + Despacho               ├─ Tramite (ida/volta)
     ├─ Denuncia (vários estados)        └─ Autenticacao (>=3 publicadas) + Notificacao
  idempotente (ON CONFLICT DO NOTHING)
```

## §7 Schema

Sem tabela nova — **popula** as tabelas existentes do Track A. **[decisão-sessão]**

## §8 APIs

Sem APIs novas. Execução via `npm run seed` (script) ou migration de seed em ambiente não-produção.

## §9 UX

Não tem tela própria; o efeito é **todas as telas populadas** (fila de análise com itens, Meus protocolos, validação pública com códigos válidos, diretório com profissionais, denúncias na fila).

## §10 Integrações

- Popula entidades de praticamente todos os PRDs do Track A.
- Habilita as demos de `prd-sial-validacao-publica`, `prd-sial-diretorio-publico`, `prd-sial-dashboard-operacional`, `prd-sial-relatorios`.

## §11 Faseamento

Fase 1: seed de pessoas/áreas/métodos/cadastros → seed de processos (todos os status) com artefatos → seed de denúncias + autenticações publicadas + notificações → smoke de contagens.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| Seed rodar em produção | B | A | Guarda por ambiente (`SIAL_MOCK`/não-prod); refuse em prod. |
| Seed quebrar com mudança de schema | M | M | Idempotente; alinhado às migrations do Track A; roda no smoke geral. |
| Dados sintéticos parecerem reais | B | B | Nomes claramente fictícios. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Cobertura de status | `SELECT count(DISTINCT status) FROM "Processo"` ≥ 8 |
| Autenticações publicadas | `SELECT count(*) FROM "Autenticacao" WHERE "publicadoEm" IS NOT NULL` ≥ 3 |
| Profissionais no diretório | `SELECT count(*) FROM "Cadastro" WHERE tipo IN ('leiloeiro','tradutor')` ≥ 4 |

## §14 Open questions

- Nenhuma (dados sintéticos de demo).

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §3.3, §6.4.
- Memory: [[project_sial_inception]] (Track A / demo 1-shot).

## §16 Stories implementáveis

```yaml
- id: SIAL-MOCK-001
  title: Seed — usuários, perfis, áreas, métodos, cadastros
  description: scripts/seed/mock-data.ts (parte 1): 5 usuários + perfis, áreas (PRORESP+setores), métodos garantidos, cadastros (empresas/leiloeiros/tradutores). Idempotente.
  acceptanceCriteria:
    - "5 usuários com perfis das personas",
    - "Área PRORESP existe",
    - ">=4 cadastros leiloeiro/tradutor",
    - "Reexecutar não duplica"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"Usuario\""
      expected: ">=5"
  dependsOn: []
  estimateMinutes: 30
  touches: ["scripts/seed/mock-data.ts"]

- id: SIAL-MOCK-002
  title: Seed — processos em todos os status (+ artefatos)
  description: ~20 processos de requerimento cobrindo todos os status, com Protocolo, Documento, Assinatura, Analise; alguns em_exigencia/tramitado/deferido.
  acceptanceCriteria:
    - ">=8 status distintos representados",
    - "Processos têm protocolo e ao menos 1 documento",
    - "Idempotente"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(DISTINCT status) FROM \"Processo\""
      expected: ">=8"
  dependsOn: [SIAL-MOCK-001]
  estimateMinutes: 30
  touches: ["scripts/seed/mock-data.ts"]

- id: SIAL-MOCK-003
  title: Seed — denúncias, trâmites, autenticações publicadas, notificações
  description: Denúncias em vários estados, trâmites ida/volta, >=3 Autenticacao publicadas com código, notificações na central.
  acceptanceCriteria:
    - ">=3 autenticações publicadas com codigoValidacao",
    - ">=2 denúncias em estados diferentes",
    - "Trâmites e notificações presentes"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM \"Autenticacao\" WHERE \"publicadoEm\" IS NOT NULL"
      expected: ">=3"
  dependsOn: [SIAL-MOCK-002]
  estimateMinutes: 30
  touches: ["scripts/seed/mock-data.ts"]

- id: SIAL-MOCK-004
  title: npm run seed (guarda de ambiente) + smoke
  description: Comando npm run seed que roda o mock-data só fora de produção; scripts/smoke/mock-data.ts confere as contagens mínimas.
  acceptanceCriteria:
    - "npm run seed popula tudo de uma vez",
    - "Recusa rodar em produção",
    - "Smoke valida cobertura de status + autenticações publicadas + diretório"
  verifiable:
    - kind: sql
      command_or_query: "SELECT (SELECT count(DISTINCT status) FROM \"Processo\")>=8 AND (SELECT count(*) FROM \"Autenticacao\" WHERE \"publicadoEm\" IS NOT NULL)>=3"
      expected: "t"
  dependsOn: [SIAL-MOCK-003]
  estimateMinutes: 25
  touches: ["package.json", "scripts/smoke/mock-data.ts"]
```

**Total: 4 stories, ~115min (~2h).**
