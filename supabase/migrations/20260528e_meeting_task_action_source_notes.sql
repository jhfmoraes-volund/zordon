-- Migration: MeetingTaskAction.sourceNoteIds uuid[]
-- Registra quais PlanningContextNotes geraram cada ação proposta
-- (rastreabilidade briefing → proposta).

ALTER TABLE "MeetingTaskAction"
  ADD COLUMN IF NOT EXISTS "sourceNoteIds" uuid[] NOT NULL DEFAULT '{}';
