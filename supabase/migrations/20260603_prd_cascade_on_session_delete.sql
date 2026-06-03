-- ProductRequirement.designSessionId: ON DELETE SET NULL → ON DELETE CASCADE.
--
-- Antes: deletar uma DesignSession orfanava os PRDs (designSessionId = NULL), e
-- por isso o endpoint DELETE /api/design-sessions/[id] bloqueava sessão com PRD
-- (code: session_has_prds, "arquive em vez de deletar").
--
-- Agora: deletar a session apaga em cascata os PRDs daquela session. O guard de
-- proteção passou a ser o vínculo com a FORGE — uma session só não pode ser
-- deletada se algum Project.forgeSourceSessionId apontar pra ela (enforced na
-- rota, code: session_is_forge_source).
--
-- ProductRequirementActivity e PlanningSessionPRD já cascateiam a partir do PRD,
-- então a cascata é limpa até as folhas.

ALTER TABLE public."ProductRequirement"
  DROP CONSTRAINT "ProductRequirement_designSessionId_fkey",
  ADD CONSTRAINT "ProductRequirement_designSessionId_fkey"
    FOREIGN KEY ("designSessionId")
    REFERENCES public."DesignSession"(id) ON DELETE CASCADE;
