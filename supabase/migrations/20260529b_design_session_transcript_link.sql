-- ═══════════════════════════════════════════════════════════
-- Fundação B — DesignSessionTranscript → TranscriptRef (SSOT) + link N:N.
--
-- Antes: cada DS tinha sua própria tabela `DesignSessionTranscript` com
-- fullText, participants, summary, actionItems — paralela ao `TranscriptRef`
-- que outras features (Planning, futuro PM Review) usam. Mesmo Roam transcript
-- importado em 2 lados viraria 2 rows físicas em tabelas diferentes.
--
-- Depois: `TranscriptRef` é a SSOT. DS linka via `DesignSessionTranscriptLink`
-- (espelha PlanningTranscriptLink). Metadados antes só na DST agora vivem em
-- TranscriptRef:
--   • endedAt timestamptz       — fim da reunião (DST.meetingEnd)
--   • participants jsonb         — lista de {name, email?}
--   • summary text               — síntese AI da transcrição
--   • actionItems jsonb          — itens de ação derivados (raramente lidos)
--
-- Dados: 2 rows na DST hoje, 1 session, 0 overlap com TranscriptRef existente.
-- Backfill é insert puro + criação de links.
-- ═══════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Estender TranscriptRef ────────────────────────────────────────────
ALTER TABLE public."TranscriptRef"
  ADD COLUMN IF NOT EXISTS "endedAt"     timestamptz,
  ADD COLUMN IF NOT EXISTS participants  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS summary       text,
  ADD COLUMN IF NOT EXISTS "actionItems" jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public."TranscriptRef".participants IS
  'Participantes da call (jsonb array de {name, email?}). Origem: DST migrado em 2026-05-29 + futuros imports.';
COMMENT ON COLUMN public."TranscriptRef".summary IS
  'Síntese gerada pelo provedor (Roam/Granola) ou pela ingestão Alpha. Texto curto.';
COMMENT ON COLUMN public."TranscriptRef"."actionItems" IS
  'Action items extraídos pela API do provedor. Lidos pelo Vitor em DS; raramente em outros lugares.';

-- ─── 2. DesignSessionTranscriptLink — N:N tipado ──────────────────────────
CREATE TABLE IF NOT EXISTS public."DesignSessionTranscriptLink" (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "designSessionId"   uuid NOT NULL REFERENCES public."DesignSession"(id) ON DELETE CASCADE,
  "transcriptRefId"   uuid NOT NULL REFERENCES public."TranscriptRef"(id) ON DELETE CASCADE,
  "linkedById"        uuid REFERENCES public."Member"(id) ON DELETE SET NULL,
  "linkedAt"          timestamptz NOT NULL DEFAULT now(),
  weight              text,
  note                text,
  CONSTRAINT "DesignSessionTranscriptLink_session_transcript_key"
    UNIQUE ("designSessionId", "transcriptRefId")
);

ALTER TABLE public."DesignSessionTranscriptLink"
  DROP CONSTRAINT IF EXISTS "DesignSessionTranscriptLink_weight_check";
ALTER TABLE public."DesignSessionTranscriptLink"
  ADD CONSTRAINT "DesignSessionTranscriptLink_weight_check"
  CHECK (weight IS NULL OR weight = ANY (ARRAY['primary'::text, 'supporting'::text, 'background'::text]));

CREATE INDEX IF NOT EXISTS "DesignSessionTranscriptLink_session_idx"
  ON public."DesignSessionTranscriptLink" ("designSessionId");
CREATE INDEX IF NOT EXISTS "DesignSessionTranscriptLink_transcript_idx"
  ON public."DesignSessionTranscriptLink" ("transcriptRefId");

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public."DesignSessionTranscriptLink" TO authenticated;

ALTER TABLE public."DesignSessionTranscriptLink" ENABLE ROW LEVEL SECURITY;

-- Visível se a DS é visível ao membro (regra do projeto).
CREATE POLICY "dst_link_select" ON public."DesignSessionTranscriptLink"
  FOR SELECT USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."DesignSession" ds
      WHERE ds.id = "designSessionId"
        AND public.can_view_project(ds."projectId")
    )
  );

-- INSERT/UPDATE/DELETE: editor de sessão.
CREATE POLICY "dst_link_insert" ON public."DesignSessionTranscriptLink"
  FOR INSERT WITH CHECK (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."DesignSession" ds
      WHERE ds.id = "designSessionId"
        AND public.can_edit_sessions(ds."projectId")
    )
  );

CREATE POLICY "dst_link_update" ON public."DesignSessionTranscriptLink"
  FOR UPDATE
  USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."DesignSession" ds
      WHERE ds.id = "designSessionId"
        AND public.can_edit_sessions(ds."projectId")
    )
  )
  WITH CHECK (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."DesignSession" ds
      WHERE ds.id = "designSessionId"
        AND public.can_edit_sessions(ds."projectId")
    )
  );

CREATE POLICY "dst_link_delete" ON public."DesignSessionTranscriptLink"
  FOR DELETE USING (
    public.is_manager()
    OR EXISTS (
      SELECT 1 FROM public."DesignSession" ds
      WHERE ds.id = "designSessionId"
        AND public.can_edit_sessions(ds."projectId")
    )
  );

-- ─── 3. Backfill TranscriptRef a partir de DesignSessionTranscript ────────
-- 0 overlap esperado (verificado pré-migration). ON CONFLICT é cinto de
-- segurança: se um dia a contagem mudar, atualiza campos faltantes em vez de
-- explodir. Princípio: preserva o que já existe; só preenche null.
INSERT INTO public."TranscriptRef" (
  source, "sourceId", title, "fullText",
  "capturedAt", "endedAt", participants, summary, "actionItems",
  "importedById", "importedAt"
)
SELECT
  dst.source,
  dst."sourceId",
  dst."meetingTitle",
  dst."fullText",
  dst."meetingStart",
  dst."meetingEnd",
  dst.participants,
  dst.summary,
  dst."actionItems",
  dst."importedByMemberId",
  dst."importedAt"
FROM public."DesignSessionTranscript" dst
ON CONFLICT (source, "sourceId") WHERE "sourceId" IS NOT NULL DO UPDATE
SET
  title        = COALESCE(public."TranscriptRef".title, EXCLUDED.title),
  "fullText"   = COALESCE(public."TranscriptRef"."fullText", EXCLUDED."fullText"),
  "capturedAt" = COALESCE(public."TranscriptRef"."capturedAt", EXCLUDED."capturedAt"),
  "endedAt"    = COALESCE(public."TranscriptRef"."endedAt", EXCLUDED."endedAt"),
  participants = CASE
    WHEN public."TranscriptRef".participants = '[]'::jsonb THEN EXCLUDED.participants
    ELSE public."TranscriptRef".participants
  END,
  summary      = COALESCE(public."TranscriptRef".summary, EXCLUDED.summary),
  "actionItems" = CASE
    WHEN public."TranscriptRef"."actionItems" = '[]'::jsonb THEN EXCLUDED."actionItems"
    ELSE public."TranscriptRef"."actionItems"
  END;

-- ─── 4. Criar links a partir das DST existentes ──────────────────────────
INSERT INTO public."DesignSessionTranscriptLink"
  ("designSessionId", "transcriptRefId", "linkedById", "linkedAt", weight)
SELECT
  dst."sessionId",
  tr.id,
  dst."importedByMemberId",
  dst."importedAt",
  'primary'
FROM public."DesignSessionTranscript" dst
JOIN public."TranscriptRef" tr
  ON tr.source = dst.source AND tr."sourceId" = dst."sourceId"
ON CONFLICT ("designSessionId", "transcriptRefId") DO NOTHING;

COMMIT;
