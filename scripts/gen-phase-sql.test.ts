/**
 * Tests do gerador SQL de phase.
 * Standalone, sem framework — padrão do projeto. Run:
 *   npx tsx scripts/gen-phase-sql.test.ts
 *
 * O gerador é a peça que torna divergência TS↔SQL impossível. Se ele estiver
 * errado, a garantia some. Por isso ele tem teste próprio.
 */
import assert from "node:assert/strict";

import { generatePhaseFunctionSQL } from "./gen-phase-sql";
import { PLANNING_PHASES, nextPhases } from "../src/lib/planning/phase";

const sql = generatePhaseFunctionSQL();

// ─── 1. Esqueleto presente ────────────────────────────────────────────────
assert.ok(
  sql.includes("CREATE OR REPLACE FUNCTION public.validate_planning_phase_transition()"),
  "header da função ausente",
);
assert.ok(sql.includes("RETURNS trigger LANGUAGE plpgsql"), "assinatura LANGUAGE/RETURNS");
assert.ok(sql.includes("RAISE EXCEPTION"), "RAISE EXCEPTION ausente");
assert.ok(sql.includes("ERRCODE = 'check_violation'"), "ERRCODE não está em check_violation");

// ─── 2. Toda transição da matriz aparece exatamente uma vez ───────────────
const expected: Array<[string, string]> = [];
for (const from of PLANNING_PHASES) {
  for (const to of nextPhases(from)) expected.push([from, to]);
}

for (const [from, to] of expected) {
  const pattern = `'${from}'`;
  const patternTo = `'${to}'`;
  // Verifica que a transição existe no SQL (não testa formato exato — o
  // teste de byte-equivalência seria frágil; testa presença de from + to
  // na mesma linha).
  const lines = sql.split("\n");
  const matchingLines = lines.filter(
    (l) => l.includes(`OLD.phase = ${pattern}`) && l.includes(`NEW.phase = ${patternTo}`),
  );
  assert.equal(
    matchingLines.length,
    1,
    `transição ${from} → ${to} deveria aparecer 1× (apareceu ${matchingLines.length}×)`,
  );
}

// ─── 3. Nenhuma transição "fantasma" no SQL ────────────────────────────────
// Conta todas as ocorrências de "OLD.phase = '" — devem ser exatamente |expected|.
const occurrences = (sql.match(/OLD\.phase = '/g) ?? []).length;
assert.equal(
  occurrences,
  expected.length,
  `SQL tem ${occurrences} branches de transição; matriz TS tem ${expected.length}. Divergência.`,
);

// ─── 4. Comentário de "reset briefing" aparece nas 2 transições → idle ────
// (sanidade do mapa TRANSITION_COMMENT)
const resetLines = sql
  .split("\n")
  .filter((l) => l.includes("reset briefing"));
assert.equal(resetLines.length, 2, `esperava 2 comentários "reset briefing", achou ${resetLines.length}`);

// ─── 5. Idempotência ──────────────────────────────────────────────────────
assert.equal(generatePhaseFunctionSQL(), sql, "geração não é determinística");

// ─── 6. Aviso de "GERADA" presente (proteção contra edição manual) ────────
assert.ok(
  sql.includes("GERADA por scripts/gen-phase-sql.ts"),
  "aviso de geração ausente — alguém editando direto perde a proteção",
);

console.log("✓ Todos os testes de gen-phase-sql passaram.");
