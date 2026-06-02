/**
 * FRS-006 — Importer de backfill: scripts/ralph/features/<slug>/prd.json
 *           → ProductRequirement.stories (DB = fonte da verdade).
 *
 * Casa por `reference` (derivada do prefixo dos story ids, ex.: SIAL-CORE-001
 * → SIAL-CORE). Normaliza agentProfile pro enum canônico do Forge e valida cada
 * story via ForgeStorySchema. Stories inválidas são reportadas, não gravadas.
 * Idempotente (sobrescreve `stories` do PRD).
 *
 * Uso:
 *   npx tsx scripts/forge/import-prd-stories.ts            # todos os features
 *   npx tsx scripts/forge/import-prd-stories.ts sial-core-process [outro...]
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { db } from "../../src/lib/db";
import { ForgeStorySchema } from "../../src/lib/forge/spec/story-schema";

const repoRoot = resolve(__dirname, "..", "..");
const featuresDir = resolve(repoRoot, "scripts", "ralph", "features");
const PRD_STATES = ["backlog", "ready", "in-progress", "blocked", "done", "archive"];

/** Acha o .md completo do PRD (docs/prd/<state>/prd-<slug>.md) p/ specMarkdown. */
function findSpecMarkdown(slug: string): string | null {
  for (const state of PRD_STATES) {
    const p = resolve(repoRoot, "docs", "prd", state, `prd-${slug}.md`);
    if (existsSync(p)) return readFileSync(p, "utf-8");
  }
  return null;
}

// agentProfile dos prd.json → enum canônico (db/api/ui/wiring/test/doc).
const PROFILE_MAP: Record<string, string> = {
  sql: "db",
  db: "db",
  lib: "wiring",
  wiring: "wiring",
  api: "api",
  ui: "ui",
  test: "test",
  doc: "doc",
};

function refFromStories(stories: Array<{ id?: string }>): string | null {
  for (const s of stories) {
    const m = typeof s.id === "string" ? s.id.match(/^(.*)-\d+$/) : null;
    if (m) return m[1];
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const slugs = argv.length > 0 ? argv : readdirSync(featuresDir).filter((d) => existsSync(join(featuresDir, d, "prd.json")));

  const supabase = db();
  let imported = 0;
  let skipped = 0;
  const problems: string[] = [];

  for (const slug of slugs) {
    const path = join(featuresDir, slug, "prd.json");
    if (!existsSync(path)) {
      problems.push(`${slug}: prd.json ausente`);
      continue;
    }
    let parsed: { userStories?: Array<Record<string, unknown>> };
    try {
      parsed = JSON.parse(readFileSync(path, "utf-8"));
    } catch (e) {
      problems.push(`${slug}: JSON inválido (${String(e)})`);
      continue;
    }
    const raw = Array.isArray(parsed.userStories) ? parsed.userStories : [];
    const ref = refFromStories(raw as Array<{ id?: string }>);
    if (!ref) {
      problems.push(`${slug}: não consegui derivar reference dos story ids`);
      continue;
    }

    // Normaliza + valida cada story.
    const valid: unknown[] = [];
    for (const s of raw) {
      const norm = {
        ...s,
        agentProfile: PROFILE_MAP[String(s.agentProfile ?? "")] ?? "wiring",
        passes: false,
      };
      const r = ForgeStorySchema.safeParse(norm);
      if (r.success) valid.push(r.data);
      else problems.push(`${ref}/${String(s.id)}: ${r.error.issues.map((i) => i.message).join("; ")}`);
    }
    if (valid.length === 0) {
      problems.push(`${ref}: nenhuma story válida`);
      continue;
    }

    const specMarkdown = findSpecMarkdown(slug);
    const patch: Record<string, unknown> = { stories: valid };
    if (specMarkdown) patch.specMarkdown = specMarkdown;

    const { data, error } = await supabase
      .from("ProductRequirement")
      .update(patch as never)
      .eq("reference", ref)
      .select("id");
    if (error) {
      problems.push(`${ref}: update falhou (${error.message})`);
      continue;
    }
    if (!data || data.length === 0) {
      skipped++;
      console.log(`⏭  ${ref}: nenhum ProductRequirement com esse reference (skip)`);
      continue;
    }
    imported++;
    console.log(`✓ ${ref}: ${valid.length} stories → ${data.length} PRD(s)`);
  }

  console.log(`\n— importados: ${imported} · skip: ${skipped} · problemas: ${problems.length}`);
  if (problems.length > 0) {
    console.log("Problemas:");
    for (const p of problems.slice(0, 40)) console.log(`  - ${p}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
