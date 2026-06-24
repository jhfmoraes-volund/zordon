# Transcript SSOT — Runbook de Saneamento

> Discutido com João em 2026-05-29.
> Pré-requisito explícito do PM Review ([`pm-review-plan.md`](../features/meetings/pm-review-plan.md)).

## Em uma frase

**`TranscriptRef` é a Single Source of Truth de transcrição no Volund.** Toda feature (Planning, PM Review, DesignSession, Meeting page, agents Vitoria/Vitor/Alpha) deve ler de lá. Hoje a SSOT existe, mas duas ilhas legadas ainda escrevem/leem em paralelo — este runbook paga as 2 dívidas.

## Princípio

Uma transcrição (Roam note, Granola call, Spreadsheet, upload manual) tem exatamente **1 row física** no banco: uma `TranscriptRef`. Quem usa, **referencia via tabela-link N:N tipada** (`PlanningTranscriptLink`, `PMReviewTranscriptLink`, `DesignSessionTranscriptLink`). Quem escreve, faz via UNIQUE `(source, sourceId)` — colisão = mesma row.

Anti-padrões a extinguir:
- Texto completo em coluna de feature (`Meeting.transcript`, `DesignSessionTranscript.fullText` quando a mesma transcrição já existe em `TranscriptRef`).
- Importer próprio por feature escrevendo em tabela própria.
- Lookup de transcrição por `meetingId` quando a transcrição **não tem** meeting (Roam-note solta).

## Estado atual (2026-05-29)

| Camada | Onde mora | Status |
|--------|-----------|--------|
| `TranscriptRef` (SSOT) | `supabase/migrations/20260528_transcript_ref.sql` + `20260528c_transcript_fulltext.sql` | ✅ Existe, backfill rodado, RLS, `fullText`. |
| `PlanningTranscriptLink` | `20260528b_planning_ceremony_core.sql` | ✅ N:N tipado, com `weight`. Padrão de referência. |
| `Meeting.transcript*` (Ilha 1) | `20260520_meeting_transcript_source.sql` + coluna `transcript` antiga | ⚠️ Leitura em 6 arquivos do app. Backfill pra TranscriptRef rodou, sweep das leituras e DROP nunca foi feito. |
| `DesignSessionTranscript` (Ilha 2) | `20260429_design_session_transcript.sql` | ⚠️ Tabela inteira separada, anterior à SSOT. Vitor lê dela direto. Hoje, mesmo Roam transcript usado em DS + Planning = 2 rows físicas. |

## PR Fundação A — Sweep `Meeting.transcript*`

**Objetivo:** colunas `Meeting.transcript`, `Meeting.transcriptSource`, `Meeting.transcriptSourceId` deixam de existir; tudo que precisa do transcript lê de `TranscriptRef` via FK reversa (`TranscriptRef.meetingId`).

### Passos

1. **Verificar backfill 100%.** SQL spot-check:
   ```sql
   SELECT m.id, m."transcriptSource", m."transcriptSourceId",
          tr.id AS tr_id, tr."fullText" IS NOT NULL AS has_full_text
   FROM "Meeting" m
   LEFT JOIN "TranscriptRef" tr
     ON tr."source" = m."transcriptSource"
    AND tr."sourceId" = m."transcriptSourceId"
   WHERE m."transcriptSource" IS NOT NULL;
   ```
   Expectativa: toda Meeting com `transcriptSource` tem `tr_id IS NOT NULL` E `has_full_text = true`. Se houver gap, completar antes de avançar.

2. **Migrar leitores (6 arquivos).** Substituir lookup direto em `Meeting.transcript*` por join com `TranscriptRef`:
   - [src/app/api/meetings/route.ts](../../src/app/api/meetings/route.ts)
   - [src/app/api/meetings/[id]/route.ts](../../src/app/api/meetings/[id]/route.ts)
   - [src/app/api/meetings/[id]/suggest-actions/route.ts](../../src/app/api/meetings/[id]/suggest-actions/route.ts)
   - [src/app/(dashboard)/meetings/[id]/page.tsx](../../src/app/(dashboard)/meetings/[id]/page.tsx)
   - [src/components/meetings/import-meeting-modal.tsx](../../src/components/meetings/import-meeting-modal.tsx)
   - [src/lib/granola-auto-import.ts](../../src/lib/granola-auto-import.ts)

   Padrão de leitura:
   ```ts
   const { data: tr } = await db()
     .from("TranscriptRef")
     .select("id, source, sourceId, fullText, capturedAt, title, byline")
     .eq("meetingId", meetingId)
     .maybeSingle();
   ```

   Padrão de import (Granola/manual): em vez de gravar `Meeting.transcript*`, fazer **INSERT em `TranscriptRef`** com `meetingId` setado (já é o que `granola-auto-import` deveria fazer; verificar e ajustar).

3. **Migration de DROP** — `<data>_drop_meeting_transcript_columns.sql`:
   ```sql
   BEGIN;
   ALTER TABLE "Meeting" DROP CONSTRAINT IF EXISTS "Meeting_transcript_pair_ck";
   DROP INDEX IF EXISTS "Meeting_transcriptSource_sourceId_key";
   ALTER TABLE "Meeting"
     DROP COLUMN IF EXISTS "transcript",
     DROP COLUMN IF EXISTS "transcriptSource",
     DROP COLUMN IF EXISTS "transcriptSourceId";
   COMMIT;
   ```

4. **Atualizar `database.types.ts`** — `npx supabase gen types ...`.

5. **Smoke test** — `/meetings/[id]` renderiza transcript; cron Granola roda; modal de import grava.

### Riscos
- **`granola-auto-import.ts` é cron.** Se rodar entre a etapa 2 e 3 com código antigo, escreveria em colunas que vão sumir. Mitigação: deploy do código novo antes da migration de DROP; OU adicionar trigger temporário que rejeita escrita nas colunas (já que NULL é permitido, fica complicado — mais simples só sequenciar bem).
- **`Meeting.transcript` legacy text.** Confirmar que `TranscriptRef.fullText` cobre 100% antes do DROP — perda silenciosa se gap.

## PR Fundação B — Migrar `DesignSessionTranscript` → `TranscriptRef`

**Objetivo:** DS deixa de ter sua própria tabela de transcript; usa `TranscriptRef` + `DesignSessionTranscriptLink` (N:N tipado).

### Passos

1. **Nova migration** — `<data>_design_session_transcript_link.sql`:
   ```sql
   BEGIN;

   -- Tabela-link tipada (espelha PlanningTranscriptLink).
   CREATE TABLE "DesignSessionTranscriptLink" (
     id uuid PK DEFAULT gen_random_uuid(),
     "designSessionId" text NOT NULL REFERENCES "DesignSession"(id) ON DELETE CASCADE,
     "transcriptRefId" uuid NOT NULL REFERENCES "TranscriptRef"(id) ON DELETE CASCADE,
     "linkedById" text REFERENCES "Member"(id) ON DELETE SET NULL,
     "linkedAt" timestamptz NOT NULL DEFAULT now(),
     weight text CHECK (weight IS NULL OR weight IN ('primary','supporting','background')),
     note text,
     UNIQUE ("designSessionId", "transcriptRefId")
   );

   -- Backfill: 1 row por DesignSessionTranscript existente.
   -- ON CONFLICT (source, sourceId) cobre duplicata com Roam já importado via Meeting.
   WITH inserted AS (
     INSERT INTO "TranscriptRef" ("source", "sourceId", title, "fullText", "capturedAt", "importedById", "importedAt")
     SELECT 'roam', dst."roamTranscriptId", dst."meetingTitle", dst."fullText",
            dst."meetingStart", dst."importedByMemberId"::uuid, dst."importedAt"
     FROM "DesignSessionTranscript" dst
     ON CONFLICT ("source", "sourceId") WHERE "sourceId" IS NOT NULL DO NOTHING
     RETURNING id, "sourceId"
   ),
   resolved AS (
     -- inclui rows recém-criadas + rows que já existiam (conflict path).
     SELECT tr.id AS "transcriptRefId", tr."sourceId" AS "roamTranscriptId"
     FROM "TranscriptRef" tr
     WHERE tr."source" = 'roam'
       AND tr."sourceId" IN (SELECT "roamTranscriptId" FROM "DesignSessionTranscript")
   )
   INSERT INTO "DesignSessionTranscriptLink" ("designSessionId", "transcriptRefId", "linkedById", "linkedAt", weight)
   SELECT dst."sessionId", r."transcriptRefId", dst."importedByMemberId"::uuid, dst."importedAt", 'primary'
   FROM "DesignSessionTranscript" dst
   JOIN resolved r ON r."roamTranscriptId" = dst."roamTranscriptId"
   ON CONFLICT ("designSessionId", "transcriptRefId") DO NOTHING;

   -- RLS espelha PlanningTranscriptLink: vê se vê ambos os lados.
   -- ... (policies: is_manager OR can_view_project via DS.projectId)

   COMMIT;
   ```

2. **DAL** — novo helper:
   ```ts
   // src/lib/dal/design-session.ts
   async function getDesignSessionTranscripts(sessionId: string): Promise<TranscriptRow[]> {
     return db()
       .from("DesignSessionTranscriptLink")
       .select("transcriptRefId, weight, transcriptRef:TranscriptRef(*)")
       .eq("designSessionId", sessionId);
   }
   ```

3. **Migrar leitores Vitor** — `loadContext()` do agent Vitor passa a usar `getDesignSessionTranscripts()` em vez de query direta em `DesignSessionTranscript`. Procurar usos:
   ```
   grep -rn "DesignSessionTranscript" src/lib/agent/agents/vitor/
   grep -rn "DesignSessionTranscript" src/lib/dal/
   ```

4. **Migrar UI** — Pre-Work step do DS importa via mesmo flow:
   - INSERT em `TranscriptRef` (com `source='roam'`, `sourceId=roamTranscriptId`).
   - INSERT em `DesignSessionTranscriptLink`.
   - Idempotente — re-import = no-op.

5. **DROP tabela** — migration separada após validação em prod:
   ```sql
   DROP TABLE "DesignSessionTranscript";
   ```

### Riscos
- **DS tem dado real (≠ Planning que era greenfield).** Backfill precisa preservar `participants`, `summary`, `actionItems`, `meetingStart/End` que hoje vivem em colunas do `DesignSessionTranscript`. **Decisão:** esses campos ficam em `TranscriptRef` ou no `DesignSessionTranscriptLink`?
  - `participants`, `meetingStart`, `meetingEnd` → fazem sentido no `TranscriptRef` (são do transcript, não da DS). Avaliar `ALTER TABLE "TranscriptRef" ADD COLUMN participants jsonb` ou expor via `Meeting` linkado.
  - `summary`, `actionItems` → são síntese gerada pela importação; podem viver em `TranscriptRef` (mesmas para todos os consumidores) ou ser regeneradas on-demand pelo Vitor.
  - **Recomendação:** adicionar `participants jsonb` + `summary text` no `TranscriptRef` na migration A (ou agora); `actionItems` reconstruir do `fullText` se Vitor precisar (raramente usado).
- **Idempotência do backfill.** `ON CONFLICT (source, sourceId)` evita duplicata, mas se um Roam transcript já entrou via Meeting + DS, o link da DS deve apontar pro `TranscriptRef` existente. CTE acima cobre via `resolved`.
- **Vitor + RLS.** Hoje DS lê transcript via policy `can_edit_sessions`. Novo path passa por `can_view_project` (TranscriptRef) + link (mesmo principle). Validar que guests não regridem em visibilidade ([[project_guest_access]]).

## PR Fundação C — Ingestor padronizado (opcional, follow-up)

**Não obrigatório, mas highly recommended** depois de A+B. Hoje os 4 importers vivem em lugares diferentes:
- `granola-auto-import.ts` (cron)
- `import-meeting-modal.tsx` (UI Roam manual)
- `/api/planning/[id]/sources/spreadsheet/route.ts` (spreadsheet)
- DS Pre-Work flow (Roam pra DS)

Cada um grava em `TranscriptRef` (após A+B) mas com seu próprio mapeamento de payload. Extrair:

```ts
// src/lib/transcripts/ingest.ts
type IngestPayload =
  | { source: "roam"; sourceId: string; fullText: string; title?: string; capturedAt?: Date; participants?: string[]; meetingId?: string }
  | { source: "granola"; sourceId: string; fullText: string; title?: string; capturedAt?: Date; meetingId?: string }
  | { source: "spreadsheet"; fullText: string; title: string; capturedAt?: Date }
  | { source: "manual"; fullText: string; title: string };

async function ingestTranscript(payload: IngestPayload): Promise<TranscriptRef> {
  // INSERT ... ON CONFLICT (source, sourceId) DO UPDATE SET fullText = EXCLUDED.fullText
  // RETURNING *. Idempotente. Retorna a row final.
}
```

Cada importer reduz a "preparar payload + chamar ingest". Ponto único de escrita. Crescimento futuro (5º source) = 1 lugar pra atualizar.

## Ordem de execução

1. **PR Fundação A** — sweep `Meeting.transcript*`. ~½ dia.
2. **PR Fundação B** — migrar `DesignSessionTranscript`. ~1-2 dias (DS tem dado real + Vitor consome).
3. **PR PM Review** — feature ([`pm-review-plan.md`](../features/meetings/pm-review-plan.md)). Já nasce em solo limpo.
4. **PR Fundação C** (follow-up) — ingestor padronizado. Quando o 5º source aparecer, ou quando o próximo importer encostar nessa camada.

## Princípio final

Toda vez que alguém pensar "vou criar uma tabela com `fullText` ou colunas de transcript", **parar e perguntar**: por que não `TranscriptRef` + tabela-link N:N tipada? Resposta deve passar por (a) shape genuinamente diferente, OU (b) constraint de RLS irreconciliável. Caso contrário, é dívida nova nascendo.
