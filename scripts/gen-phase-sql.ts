/**
 * Gera o corpo SQL da função/trigger de guardrail da PlanningCeremony.phase
 * a partir da matriz `ALLOWED_TRANSITIONS` do TS — a ÚNICA fonte de verdade.
 *
 * Uso:
 *   npx tsx scripts/gen-phase-sql.ts                  → stdout
 *   npx tsx scripts/gen-phase-sql.ts --check          → exit 0 se a migration
 *                                                       já no disco bate, 1 senão
 *   npx tsx scripts/gen-phase-sql.ts --write FILE     → grava em FILE
 *
 * Por que: o trigger SQL espelha a matriz TS. Sem geração, qualquer mudança
 * no TS pode esquecer o SQL e o cinto-de-segurança vira teatro. Com geração,
 * divergência é literalmente impossível.
 *
 * IMPORTANTE: a saída deste script é a forma CANÔNICA. NÃO editar a migration
 * 20260528d à mão. Se a matriz mudar:
 *   1. Edita ALLOWED_TRANSITIONS em src/lib/planning/phase.ts.
 *   2. Roda este script com --write na NOVA migration (nunca sobrescrever
 *      migration já rodada em prod — schema migrations são imutáveis).
 *   3. psql -f new-migration.sql.
 */
import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  PLANNING_PHASES,
  type PlanningPhase,
} from "../src/lib/planning/phase";

// Re-imports do módulo pra garantir que estamos olhando o mesmo arquivo
// que o runtime usa (single source of truth de verdade).
import * as phase from "../src/lib/planning/phase";

// `ALLOWED_TRANSITIONS` é privada ao módulo de propósito (ninguém deve mutar).
// Pra geração, expomos via `nextPhases` — reconstruímos o conjunto a partir
// das fases conhecidas. Isso garante que se uma fase nova for adicionada,
// o gerador a leva em conta sem precisar de export extra.
function collectTransitions(): Array<[PlanningPhase, PlanningPhase]> {
  const out: Array<[PlanningPhase, PlanningPhase]> = [];
  for (const from of PLANNING_PHASES) {
    for (const to of phase.nextPhases(from)) {
      out.push([from, to]);
    }
  }
  return out;
}

/**
 * Comentários inline pra transições específicas. Mantemos o conjunto curto
 * — só as que precisam de contexto humano. Outras saem sem comentário.
 */
const TRANSITION_COMMENT: Record<string, string> = {
  "reading->idle": "reset briefing",
  "proposing->idle": "reset briefing",
};

/**
 * Calcula a largura da coluna `OLD.phase = 'X'` pra alinhar visualmente.
 * Ex: `'proposing'` é a maior fase, então todas as outras ganham padding.
 */
function maxPhaseLen(transitions: Array<[PlanningPhase, PlanningPhase]>): number {
  return Math.max(...transitions.map(([from]) => from.length));
}

function renderMatrixLines(
  transitions: Array<[PlanningPhase, PlanningPhase]>,
): string[] {
  const width = maxPhaseLen(transitions);
  const lines: string[] = [];

  transitions.forEach(([from, to], i) => {
    const prefix = i === 0 ? "     " : "  OR ";
    const fromQ = `'${from}'`.padEnd(width + 2);
    const toQ = `'${to}'`;
    const comment = TRANSITION_COMMENT[`${from}->${to}`];
    const base = `${prefix}(OLD.phase = ${fromQ} AND NEW.phase = ${toQ})`;
    lines.push(comment ? `${base.padEnd(58)}-- ${comment}` : base);
  });

  return lines;
}

/**
 * Gera o corpo completo da função SQL. O contexto (BEGIN/COMMIT, DROP TRIGGER,
 * CREATE TRIGGER) NÃO é gerado aqui — fica na migration, porque é boilerplate
 * estável que não depende da matriz.
 */
export function generatePhaseFunctionSQL(): string {
  const transitions = collectTransitions();
  const matrix = renderMatrixLines(transitions).join("\n");

  return `CREATE OR REPLACE FUNCTION public.validate_planning_phase_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Sem mudança de phase → passa direto (UPDATE de outros campos).
  IF NEW.phase = OLD.phase THEN
    RETURN NEW;
  END IF;

  -- Matriz de transições permitidas. GERADA por scripts/gen-phase-sql.ts
  -- a partir de src/lib/planning/phase.ts (ALLOWED_TRANSITIONS).
  -- NÃO editar à mão — regenerar via \`npm run gen:phase-sql\`.
  IF NOT (
${matrix}
  ) THEN
    RAISE EXCEPTION 'PlanningCeremony.phase: transição % → % não permitida',
      OLD.phase, NEW.phase
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;`;
}

// ─── CLI ──────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const sql = generatePhaseFunctionSQL();

  const checkIdx = args.indexOf("--check");
  const writeIdx = args.indexOf("--write");

  if (checkIdx !== -1) {
    const target = args[checkIdx + 1];
    if (!target) {
      console.error("--check requer FILE");
      process.exit(2);
    }
    const current = readFileSync(resolve(target), "utf8");
    if (!current.includes(sql)) {
      console.error(
        `✗ ${target} não contém o SQL gerado atual.\n` +
          `  Rode \`npx tsx scripts/gen-phase-sql.ts\` e compare.`,
      );
      process.exit(1);
    }
    console.log(`✓ ${target} está em sincronia com phase.ts.`);
    return;
  }

  if (writeIdx !== -1) {
    const target = args[writeIdx + 1];
    if (!target) {
      console.error("--write requer FILE");
      process.exit(2);
    }
    writeFileSync(resolve(target), sql + "\n", "utf8");
    console.log(`✓ Escrito em ${target}`);
    return;
  }

  // Default: stdout.
  console.log(sql);
}

if (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (import.meta as any).url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("gen-phase-sql.ts")
) {
  main();
}
