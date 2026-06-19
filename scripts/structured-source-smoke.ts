#!/usr/bin/env -S npx tsx
/**
 * Smoke / verifiable da Fase 1 — Structured Context Sources.
 * Runbook: docs/runbooks/structured-context-sources-runbook.md §12.
 *
 * Exercita o engine (structured-query) + a detecção (structured-detect) sobre
 * um fixture activity JSON, SEM subir Supabase/Next (importa relativo, não @/).
 *
 * Asserts:
 *  1. detect: JSON grande → 'json'; prosa → null; csv kind → 'csv'; vazio → null
 *  2. describe: colunas + tipos + rowCount exato (shape mecânico, sem blob)
 *  3. query: agregação com contagem EXATA, bounded
 *  4. query: row-cap em 200 (rowCapped=true) quando o SELECT volta mais
 *  5. query: SQL ruim → ok:false + schema de volta (self-correcting)
 *  6. D10: fixture é estruturado E > 50k chars → read_context_source rotearia stub
 *
 * Uso: npx tsx scripts/structured-source-smoke.ts
 */
import { detectStructuredFormat } from "../src/lib/agent/tools/structured-detect";
import {
  describeStructured,
  queryStructured,
} from "../src/lib/agent/tools/structured-query";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  const tag = cond ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  ${tag} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

// ── Fixture: activity report (mesma forma do atividade-brenda-features.json) ──
const CONTRIBUTORS = ["brenda", "guilherme", "joao", "ana"];
const features = [];
for (let f = 0; f < 300; f++) {
  const commits = [];
  const n = 5 + (f % 10);
  for (let c = 0; c < n; c++) {
    commits.push({
      sha: `${f}_${c}_`.padEnd(40, "a"),
      message: `feat(BR-${f}): parte ${c} com descrição longa o suficiente pra inflar`,
      files: [`src/feat-${f}/a-${c}.ts`, `src/feat-${f}/b-${c}.ts`],
      lines_added: 10 + c,
      lines_removed: c,
    });
  }
  features.push({
    contributor: CONTRIBUTORS[f % CONTRIBUTORS.length],
    feature_id: `BR-${String(f).padStart(3, "0")}`,
    name: `Feature ${f}`,
    layer: ["frontend", "backend", "infra"][f % 3],
    commit_count: commits.length,
    period_first: "2026-05-01",
    period_last: "2026-06-15",
    commits,
  });
}
const fullText = JSON.stringify(features);
const SID = "smoke-fixture";

async function main() {
  console.log(`\nFixture: ${(fullText.length / 1024 / 1024).toFixed(2)} MB, ${features.length} features\n`);

  // 1. Detecção
  console.log("1. detectStructuredFormat");
  check("JSON grande → 'json'", detectStructuredFormat({ kind: "document", fullText }) === "json");
  check("prosa → null", detectStructuredFormat({ kind: "document", fullText: "Reunião sobre o projeto. Decidimos X." }) === null);
  check("kind spreadsheet_csv → 'csv'", detectStructuredFormat({ kind: "spreadsheet_csv", fullText: "a,b\n1,2" }) === "csv");
  check("vazio → null", detectStructuredFormat({ kind: "document", fullText: "" }) === null);
  check("JSON malformado → null", detectStructuredFormat({ kind: "document", fullText: "{ not json" }) === null);

  // 2. Describe (shape mecânico)
  console.log("\n2. describeStructured");
  const desc = await describeStructured(SID, "json", fullText);
  const colNames = desc.columns.map((c) => c.name);
  check("retorna colunas", desc.columns.length > 0, colNames.join(", "));
  check("tem contributor + feature_id + commits", ["contributor", "feature_id", "commits"].every((c) => colNames.includes(c)));
  check("rowCount exato (300)", desc.rowCount === 300, `rowCount=${desc.rowCount}`);
  check("table = 'src'", desc.table === "src");
  const commitsCol = desc.columns.find((c) => c.name === "commits");
  check("commits é tipo array/struct", !!commitsCol && /\[\]|STRUCT/i.test(commitsCol.type), commitsCol?.type);

  // 3. Agregação exata
  console.log("\n3. queryStructured — agregação");
  const agg = await queryStructured(SID, "json", fullText, "SELECT contributor, COUNT(*) AS features, SUM(commit_count) AS commits FROM src GROUP BY contributor ORDER BY contributor");
  check("ok", agg.ok === true);
  if (agg.ok) {
    check("4 contribuidores", agg.rows.length === 4, `rows=${agg.rows.length}`);
    // 300 features / 4 contribuidores = 75 cada (round-robin)
    const ana = agg.rows.find((r) => r.contributor === "ana");
    check("contagem exata (ana=75 features)", Number(ana?.features) === 75, `ana.features=${ana?.features}`);
    check("BigInt serializado como number", typeof ana?.commits === "number", `typeof commits=${typeof ana?.commits}`);
  }

  // 4. Row cap (200)
  console.log("\n4. queryStructured — row cap");
  const wide = await queryStructured(SID, "json", fullText, "SELECT feature_id FROM src");
  check("ok", wide.ok === true);
  if (wide.ok) {
    check("rowsReturned capado em 200", wide.rowsReturned === 200, `rowsReturned=${wide.rowsReturned}`);
    check("rowCapped = true", wide.rowCapped === true);
  }

  // 5. Self-correcting (SQL ruim → schema de volta)
  console.log("\n5. queryStructured — self-correcting");
  const bad = await queryStructured(SID, "json", fullText, "SELECT coluna_que_nao_existe FROM src");
  check("ok = false", bad.ok === false);
  if (!bad.ok) {
    check("devolve error", !!bad.error, bad.error.slice(0, 60));
    check("devolve schema (columns) pra reescrever", bad.columns.length > 0, `${bad.columns.length} cols`);
  }
  const ddl = await queryStructured(SID, "json", fullText, "DROP TABLE src");
  check("DDL bloqueado (read-only guard)", ddl.ok === false);

  // 6. D10 routing premissa
  console.log("\n6. D10 — roteamento read_context_source");
  check("fixture é estruturado E > 50k chars → rotearia pra stub", detectStructuredFormat({ kind: "document", fullText }) === "json" && fullText.length > 50_000, `len=${fullText.length}`);

  console.log(`\n${failures === 0 ? "\x1b[32m✓ TODOS OS ASSERTS PASSARAM\x1b[0m" : `\x1b[31m✗ ${failures} ASSERT(S) FALHARAM\x1b[0m`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke fatal:", err);
  process.exit(1);
});
