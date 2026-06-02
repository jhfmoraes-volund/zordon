-- FRS-001: stories ricas (com verifiable) no ProductRequirement.
-- DB = fonte da verdade do PRD; o Forge (snapshotManifest) passa a emitir
-- 1 manifest story por item daqui, carregando acceptanceCriteria + verifiable.
-- Shape por item (validado na app via ForgeStorySchema, jsonb livre no DB):
--   { id, title, description?, acceptanceCriteria: string[], dependsOn: string[],
--     agentProfile, estimateMinutes, touches: string[],
--     verifiable: [{kind, command_or_query, expected}], passes?: boolean }
ALTER TABLE "ProductRequirement"
  ADD COLUMN IF NOT EXISTS "stories" jsonb NOT NULL DEFAULT '[]'::jsonb;
