/**
 * VRS-006 — Smoke do contrato: o Vitor (ProposePrdInput.stories) agora exige
 * stories §16 válidas. Valida o ForgeStorySchema sem rodar o LLM nem o DB.
 *
 * Uso: npx tsx scripts/forge/test-smoke-vitor-stories.ts
 */
import { z } from "zod";
import { ForgeStorySchema } from "../../src/lib/forge/spec/story-schema";

const valid = {
  id: "AUTH-001",
  title: "Migration — tabela User (+RLS)",
  acceptanceCriteria: ["Tabela User existe", "RLS habilitado"],
  verifiable: [{ kind: "sql", command_or_query: "SELECT 1", expected: "1" }],
  dependsOn: [],
  agentProfile: "db",
  estimateMinutes: 15,
  touches: ["supabase/migrations/"],
};

const noVerifiable = { ...valid, verifiable: [] };
const tooLong = { ...valid, estimateMinutes: 45 };
const badProfile = { ...valid, agentProfile: "sql" }; // não é enum canônico

let ok = true;
function check(name: string, cond: boolean) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}`);
  if (!cond) ok = false;
}

check("story válida passa", ForgeStorySchema.safeParse(valid).success);
check("sem verifiable rejeita", !ForgeStorySchema.safeParse(noVerifiable).success);
check("estimateMinutes>30 rejeita", !ForgeStorySchema.safeParse(tooLong).success);
check("agentProfile inválido rejeita", !ForgeStorySchema.safeParse(badProfile).success);
check(
  "array vazio de stories rejeita (PRD precisa de ≥1)",
  !z.array(ForgeStorySchema).min(1).safeParse([]).success,
);

console.log(ok ? "✅ SMOKE OK — contrato §16 do Vitor enforça verifiable/≤30min/perfil" : "❌ SMOKE FAIL");
process.exit(ok ? 0 : 1);
