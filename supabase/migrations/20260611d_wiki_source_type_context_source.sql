-- Wiki cita docs do pool (Drive/GSheets/Notion) como fonte tipada (runbook D10).
-- Regra do repo: bullet sem ref tipada não publica.
ALTER TABLE "ProjectWikiSectionSource" DROP CONSTRAINT "ProjectWikiSectionSource_sourceType_check";
ALTER TABLE "ProjectWikiSectionSource" ADD CONSTRAINT "ProjectWikiSectionSource_sourceType_check"
  CHECK ("sourceType" IN ('meeting','design_session','task','sprint','pm_review','context_source'));
