/**
 * FRS-007 — Smoke: PR rico (stories no DB) está pronto pro Forge consumir como
 * run multi-story com verifiable.
 *
 * snapshotManifest mapeia `ProductRequirement.stories` 1:1 → manifest stories
 * (toManifestStory). Logo, asserir nas stories do DB é equivalente e não exige
 * o runtime do Next (forge-project.ts usa alias @/, que tsx standalone não
 * resolve). Verifica: >1 story, e cada uma com ≥1 verifiable e ≥1 AC.
 *
 * Pré: rodar o importer antes.
 * Uso: npx tsx scripts/forge/test-smoke-rich-stories.ts [REFERENCE=SIAL-CORE]
 */
import { db } from "../../src/lib/db";
import { ForgeStorySchema } from "../../src/lib/forge/spec/story-schema";

async function main() {
  const ref = process.argv[2] ?? "SIAL-CORE";
  const supabase = db();
  const { data: pr, error } = await supabase
    .from("ProductRequirement")
    .select("reference, stories")
    .eq("reference", ref)
    .maybeSingle();
  if (error || !pr) {
    console.error(`FAIL: ${ref} não encontrado (${error?.message ?? "sem row"})`);
    process.exit(1);
  }
  const stories = Array.isArray(pr.stories)
    ? (pr.stories as Array<Record<string, unknown>>)
    : [];

  if (stories.length <= 1) {
    console.error(`FAIL: ${ref}.stories=${stories.length} (esperado >1 — rode o importer)`);
    process.exit(1);
  }

  // Cada story tem de ser válida (ForgeStorySchema) e ter ≥1 verifiable + ≥1 AC.
  let allValid = true;
  for (const s of stories) {
    const r = ForgeStorySchema.safeParse(s);
    const v = Array.isArray(s.verifiable) ? s.verifiable.length : 0;
    const ac = Array.isArray(s.acceptanceCriteria) ? s.acceptanceCriteria.length : 0;
    if (!r.success || v < 1 || ac < 1) {
      allValid = false;
      console.error(`  ✗ ${String(s.id)}: valid=${r.success} verifiable=${v} ac=${ac}`);
    }
  }

  console.log(`${ref}: stories=${stories.length} allValid+verifiable+ac=${allValid}`);
  if (allValid) {
    console.log("✅ SMOKE OK — PR rico pronto p/ run multi-story com verifiable");
    process.exit(0);
  }
  console.error("❌ SMOKE FAIL");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
