# PRD — SIAL Documentos (Storage, geração e E2DOC)

**Reference**: SIAL-DOC
**Status**: backlog
**Author**: João + Claude
**Date**: 2026-06-01
**Projeto**: SIAL (JUCESP) · DesignSession Inception `b0a0f115-0ba3-48e6-92c2-244fe115855b`
**Runtime**: sial-web-app (React + Supabase + GCP)
**Depende de**: `prd-sial-core-process`

## Grounding

> Legenda: `[doc §X]` = explícito no insumo · `[decisão-sessão]` = decidido nesta DS · `[inferência]` = proposta de implementação a validar.

- **[doc]**: módulo de arquivos faz upload, combinação de PDFs e geração de documentos (RF02, doc §6A.1, §7); STORAGE é separado do banco transacional; binário **fora do Postgres**, banco guarda só metadados/referência `storage_ref`/`e2doc_id` (modelagem §6); E2DOC guarda a imagem do documento no deferimento (doc §9, §6A.4).
- **[decisão-sessão]**: módulo STORAGE = Supabase Storage; E2DOC permanece como GED externo.
- **[inferência]**: schema da tabela `Documento`, interfaces `StorageGateway`/`E2docGateway`, mecanismo de combinação de PDFs, paths de API. A validar com a JUCESP.

## Demo/Mock (one-shot)

> Roda em **mock-mode**. `StorageGateway` mock (in-memory/local) e `E2docGateway` mock (retorna `e2docId` fake) vêm de `getGateways()`. Geração de PDF e combinação funcionam de verdade; só o destino (Storage/E2DOC real) é mock. Smoke por `scripts/smoke/documentos.ts`: upload + geração aparecem na lista, metadados no banco, binário fora dele. Supabase Storage real / E2DOC = Track B.

## §1 Problema

1. Os fluxos produzem e recebem documentos (requerimento, termo, comprovantes) que precisam de **upload, combinação de PDFs e geração a partir dos dados** (RF02, doc §6A.1, §7).
2. Guardar o **binário no Postgres** deixaria o banco pesado e caro; o diagrama separa STORAGE do transacional (modelagem §6).
3. No deferimento, a imagem do documento precisa **subir ao E2DOC** (doc §6A.4, §9).

## §2 Solução em uma frase

Um módulo de documentos que mantém só **metadados e referências** no Postgres, guarda o binário no **Supabase Storage**, gera documentos a partir de template+dados, combina PDFs e referencia o **E2DOC** quando aplicável.

## §3 Não-objetivos

- Assinatura dos documentos — `prd-sial-assinatura`.
- O conteúdo/layout legal do Termo de Autenticidade — `prd-sial-termo-autenticidade` (este PRD entrega o mecanismo de geração genérico).
- Integração E2DOC **completa/resiliente** — aqui um `E2docGateway` (stub) + o ponto de upload no deferimento; resiliência em `prd-sial-integracao-resiliencia`.

## §4 Personas e jornada

- **Requerente**: "Quero anexar meus arquivos e ver os documentos gerados do meu pedido."
- **Resolvedor**: "Quero abrir os documentos do protocolo durante a análise."

## §5 Decisões fixadas

| Dn | Decisão | Fonte |
|----|---------|-------|
| D1 | `Documento` guarda só metadados: `storageRef` (Supabase Storage) + `e2docId` (E2DOC); nunca o binário | [doc] modelagem §6 |
| D2 | `origem` ∈ `gerado`/`upload`; `tipo` livre (ex.: requerimento, termo_compromisso, termo_autenticidade, comprovante) | [doc] §7; [inferência] valores |
| D3 | `StorageGateway` (Supabase Storage) e `E2docGateway` (stub) atrás de interfaces | [decisão-sessão] + [inferência] |
| D4 | Geração de documento por **template + dados** do processo (engine simples de template) | [doc] §6A.1 (gerar documentos a partir dos dados) |
| D5 | Upload ao E2DOC acontece **no deferimento** (gatilho consumido por `prd-sial-decisao-deferir`) | [doc] §6A.4 |

## §6 Arquitetura

```
Documento (metadados) ──storageRef──► Supabase Storage (binário)
                       └─e2docId────► E2DOC (GED externo, no deferimento)

POST .../documentos/upload   → StorageGateway.put() → Documento(origem=upload)
POST .../documentos/gerar    → template+dados → PDF → Storage → Documento(origem=gerado)
POST /api/documentos/combinar→ merge PDFs → novo Documento
(no deferimento) E2docGateway.upload(storageRef) → Documento.e2docId
```

## §7 Schema

```sql
-- 1) <data>_sial_documento.sql                    -- [doc] modelagem §6 (referência); [inferência] colunas
CREATE TABLE "Documento" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "processoId" uuid NOT NULL REFERENCES "Processo"(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  nome text NOT NULL,
  origem text NOT NULL CHECK (origem IN ('gerado','upload')),
  "storageRef" text,
  "e2docId" text,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','substituido')),
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "Documento_processo_idx" ON "Documento" ("processoId");
ALTER TABLE "Documento" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "documento_select" ON "Documento" FOR SELECT USING (EXISTS (
  SELECT 1 FROM "Processo" p WHERE p.id="processoId"
    AND (p."requerenteId"=sial_current_usuario() OR sial_is_servidor())));
```

## §8 APIs

| Método | Path | Contrato |
|--------|------|----------|
| POST | `/api/processos/:id/documentos/upload` | multipart → StorageGateway.put → `Documento(origem=upload)` → 201 |
| POST | `/api/processos/:id/documentos/gerar` | `{tipo, template, dados}` → PDF → Storage → 201 |
| POST | `/api/documentos/combinar` | `{documentoIds[]}` → PDF combinado → novo Documento → 201 |
| GET | `/api/processos/:id/documentos` | → lista de documentos |
| GET | `/api/documentos/:id` | → metadados + signed URL (Storage) |

## §9 UX

```
┌──── Documentos do protocolo 2026-000123 ──────────┐
│ 📄 Requerimento.pdf            gerado   [abrir]    │
│ 📄 Comprovante_caucao.pdf      upload   [abrir]    │
│ 📄 Termo_autenticidade.pdf     gerado   [abrir]    │
│ ─────────────────────────────────────────────────│
│ [ Anexar arquivo ]   [ Combinar selecionados ]    │
└─────────────────────────────────────────────────────┘
```

## §10 Integrações

- `StorageGateway` → Supabase Storage. `E2docGateway` → E2DOC (stub aqui; real/resiliente em `prd-sial-integracao-resiliencia`).
- `prd-sial-assinatura`: assina documentos desta tabela.
- `prd-sial-decisao-deferir`: aciona upload ao E2DOC.
- `prd-sial-dominio-leiloeiro`: termo de compromisso e comprovante de caução são `Documento`.

## §11 Faseamento

Fase 1: schema `Documento` → StorageGateway (Supabase) → upload → geração por template → combinação de PDFs → E2docGateway (stub) → smoke. Binário sempre fora do banco.

## §12 Riscos

| Risco | Prob | Impacto | Mitigação |
|-------|------|---------|-----------|
| E2DOC indisponível no deferimento | M | A | Upload assíncrono com retry (PRD resiliência); deferimento não bloqueia no E2DOC. |
| Arquivos grandes/abuso de upload | M | M | Limite de tamanho/tipo no StorageGateway; varredura. |
| Combinação de PDFs pesada | B | M | Processar fora do request (job) se necessário. |

## §13 Métricas de sucesso

| Métrica | Instrumento |
|---------|-------------|
| Documentos por origem | `SELECT origem, count(*) FROM "Documento" GROUP BY 1` |
| Documentos sem e2docId após deferimento | `SELECT count(*) FROM "Documento" d JOIN "Processo" p ON p.id=d."processoId" WHERE p.status='deferido' AND d."e2docId" IS NULL` |

## §14 Open questions

- ❓ Quais tipos de documento o E2DOC deve receber (todos ou só o termo)? **A confirmar com a JUCESP.**

## §15 Referências

- Insumos: `Documento_de_Produto_SIAL.md` §6A.1, §6A.4, §7, §9; `Modelagem_de_Dados_SIAL.md` §6.
- DesignSession card "Módulo de Arquivos / Storage".

## §16 Stories implementáveis

```yaml
- id: SIAL-DOC-001
  title: Migration — tabela Documento (+ RLS)
  description: Cria Documento conforme §7 com CHECK origem/status e policy de SELECT.
  acceptanceCriteria:
    - "Documento.origem CHECK ('gerado','upload')"
    - "Colunas storageRef e e2docId presentes"
    - "Policy documento_select existe"
  verifiable:
    - kind: sql
      command_or_query: "SELECT count(*) FROM pg_policies WHERE tablename='Documento'"
      expected: "1"
  dependsOn: []
  estimateMinutes: 20
  touches: ["supabase/migrations/"]

- id: SIAL-DOC-002
  title: StorageGateway — Supabase Storage
  description: src/lib/sial/storage-gateway.ts com put/getSignedUrl sobre o Supabase Storage (bucket privado).
  acceptanceCriteria:
    - "put salva o binário e retorna storageRef"
    - "getSignedUrl retorna URL temporária"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 25
  touches: ["src/lib/sial/storage-gateway.ts"]

- id: SIAL-DOC-003
  title: E2docGateway — interface + stub
  description: src/lib/sial/e2doc-gateway.ts com upload(storageRef) (stub retorna e2docId fake). Real em PRD resiliência.
  acceptanceCriteria:
    - "Interface E2docGateway + stub"
    - "upload retorna e2docId determinístico"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: []
  estimateMinutes: 20
  touches: ["src/lib/sial/e2doc-gateway.ts"]

- id: SIAL-DOC-004
  title: API upload + listar + get (signed URL)
  description: POST upload (multipart), GET lista, GET documento com signed URL.
  acceptanceCriteria:
    - "Upload cria Documento(origem=upload) com storageRef"
    - "GET documento retorna signed URL"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-DOC-001, SIAL-DOC-002]
  estimateMinutes: 30
  touches: ["src/app/api/processos/[id]/documentos/upload/route.ts", "src/app/api/processos/[id]/documentos/route.ts", "src/app/api/documentos/[id]/route.ts"]

- id: SIAL-DOC-005
  title: Geração por template + combinação de PDFs
  description: src/lib/sial/documento-gen.ts (template+dados → PDF) + POST gerar e POST combinar.
  acceptanceCriteria:
    - "gerar produz PDF a partir de template+dados e cria Documento(origem=gerado)"
    - "combinar mescla N PDFs num novo Documento"
  verifiable:
    - kind: typecheck
      command_or_query: "npx tsc --noEmit"
      expected: "exit 0"
  dependsOn: [SIAL-DOC-002]
  estimateMinutes: 30
  touches: ["src/lib/sial/documento-gen.ts", "src/app/api/processos/[id]/documentos/gerar/route.ts", "src/app/api/documentos/combinar/route.ts"]

- id: SIAL-DOC-006
  title: Painel de documentos + types + smoke
  description: Componente de lista/abrir/anexar/combinar; regenera types; smoke de upload+geração.
  acceptanceCriteria:
    - "Painel lista e abre documentos via signed URL"
    - "Smoke: upload de 1 arquivo + geração de 1 documento aparecem na lista"
  verifiable:
    - kind: manual_browser
      command_or_query: "Anexar um PDF e gerar o requerimento; abrir ambos"
      expected: "ambos aparecem e abrem; binário no Storage, metadados no banco"
  dependsOn: [SIAL-DOC-004, SIAL-DOC-005]
  estimateMinutes: 25
  touches: ["src/components/sial/documentos-panel.tsx", "src/lib/supabase/database.types.ts"]
```

**Total: 6 stories, ~150min (~2h30).**
