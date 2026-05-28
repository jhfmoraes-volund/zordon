/**
 * Tests for PlanningCeremony.phase state machine.
 * Standalone — sem framework, pra rodar via:
 *   npx tsx src/lib/planning/phase.test.ts
 *
 * Cobre 3 eixos:
 *   1. Transições válidas (matriz + pré-condições) → stamps corretos.
 *   2. Transições inválidas (não está na matriz, ator errado, pré-condição).
 *   3. `nextPhases` lista corretamente.
 */
import assert from "node:assert/strict";
import {
  transition,
  nextPhases,
  type PhaseContext,
  type Actor,
} from "./phase";

// ─── Helpers ───────────────────────────────────────────────────────────────

const FIXED_NOW = "2026-05-28T12:00:00.000Z";
const now = () => FIXED_NOW;

function ctx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  return {
    linkedMeetingCount: 0,
    linkedTranscriptCount: 0,
    contextNoteCount: 0,
    summaryNoteCount: 0,
    pendingActionCount: 0,
    ...overrides,
  };
}

function expectOk(
  from: string,
  to: string,
  c: PhaseContext,
  actor: Actor,
): ReturnType<typeof transition> & { ok: true } {
  const r = transition(from, to, c, actor, now);
  if (!r.ok) {
    throw new Error(`Esperava ok, recebeu erro: ${r.reason} — ${r.detail}`);
  }
  return r;
}

function expectErr(
  from: string,
  to: string,
  c: PhaseContext,
  actor: Actor,
  expectedReason: string,
): ReturnType<typeof transition> & { ok: false } {
  const r = transition(from, to, c, actor, now);
  if (r.ok) {
    throw new Error(`Esperava erro (${expectedReason}), recebeu ok`);
  }
  assert.equal(r.reason, expectedReason, `motivo esperado: ${expectedReason}, recebido: ${r.reason}`);
  return r;
}

// ─── 1. TRANSIÇÕES VÁLIDAS ─────────────────────────────────────────────────

// idle → reading (PM, com ≥1 insumo)
{
  const r = expectOk("idle", "reading", ctx({ linkedMeetingCount: 1 }), "pm");
  assert.equal(r.stamps.startedAt, FIXED_NOW);
  assert.equal(r.stamps.briefingGeneratedAt, undefined);
}

// idle → reading também aceita só transcript linkado (não exige meeting)
{
  const r = expectOk("idle", "reading", ctx({ linkedTranscriptCount: 2 }), "pm");
  assert.equal(r.stamps.startedAt, FIXED_NOW);
}

// reading → proposing (Alpha, com ≥1 summary + ≥3 outras)
{
  const r = expectOk(
    "reading",
    "proposing",
    ctx({ contextNoteCount: 4, summaryNoteCount: 1 }),
    "alpha",
  );
  assert.equal(r.stamps.briefingGeneratedAt, FIXED_NOW);
  assert.equal(r.stamps.startedAt, undefined);
}

// proposing → approving (PM, com ≥1 pendente)
{
  const r = expectOk("proposing", "approving", ctx({ pendingActionCount: 3 }), "pm");
  assert.deepEqual(r.stamps, {}, "approving não stampa timestamp");
}

// approving → closed (PM, 0 pendentes)
{
  const r = expectOk("approving", "closed", ctx({ pendingActionCount: 0 }), "pm");
  assert.equal(r.stamps.closedAt, FIXED_NOW);
}

// closed → archived
{
  const r = expectOk("closed", "archived", ctx(), "pm");
  assert.equal(r.stamps.archivedAt, FIXED_NOW);
}

// reading → idle (reset, PM)
{
  const r = expectOk("reading", "idle", ctx(), "pm");
  assert.deepEqual(r.stamps, {}, "reset não stampa timestamp");
}

// proposing → idle (reset, PM)
expectOk("proposing", "idle", ctx(), "pm");

// ─── 2. TRANSIÇÕES INVÁLIDAS ────────────────────────────────────────────────

// Fora da matriz
expectErr("idle", "closed", ctx({ linkedMeetingCount: 1 }), "pm", "invalid_transition");
expectErr("idle", "archived", ctx(), "pm", "invalid_transition");
expectErr("closed", "reading", ctx(), "pm", "invalid_transition");
expectErr("approving", "idle", ctx(), "pm", "invalid_transition"); // reset só de reading/proposing

// Ator errado
expectErr("idle", "reading", ctx({ linkedMeetingCount: 1 }), "alpha", "wrong_actor");
expectErr("reading", "proposing", ctx({ contextNoteCount: 4, summaryNoteCount: 1 }), "pm", "wrong_actor");
expectErr("approving", "closed", ctx(), "alpha", "wrong_actor");
expectErr("reading", "idle", ctx(), "alpha", "wrong_actor");

// Pré-condição: idle → reading sem insumo
expectErr("idle", "reading", ctx(), "pm", "missing_preconditions");

// Pré-condição: reading → proposing sem summary
expectErr("reading", "proposing", ctx({ contextNoteCount: 5 }), "alpha", "missing_preconditions");

// Pré-condição: reading → proposing com summary mas poucas outras notes
expectErr(
  "reading",
  "proposing",
  ctx({ contextNoteCount: 2, summaryNoteCount: 1 }), // 1 summary + 1 outra = só 1 outra (precisa 3)
  "alpha",
  "missing_preconditions",
);

// Pré-condição: proposing → approving sem actions pendentes
expectErr("proposing", "approving", ctx(), "pm", "missing_preconditions");

// Pré-condição: approving → closed com pendentes restantes
expectErr("approving", "closed", ctx({ pendingActionCount: 1 }), "pm", "missing_preconditions");

// Phase desconhecida
expectErr("foo", "reading", ctx(), "pm", "unknown_phase");
expectErr("idle", "bar", ctx({ linkedMeetingCount: 1 }), "pm", "unknown_phase");

// ─── 3. nextPhases ─────────────────────────────────────────────────────────

assert.deepEqual(nextPhases("idle").sort(), ["reading"].sort());
assert.deepEqual(nextPhases("reading").sort(), ["idle", "proposing"].sort());
assert.deepEqual(nextPhases("proposing").sort(), ["approving", "idle"].sort());
assert.deepEqual(nextPhases("approving"), ["closed"]);
assert.deepEqual(nextPhases("closed"), ["archived"]);
assert.deepEqual(nextPhases("archived"), [], "archived é terminal");

console.log("✓ Todos os testes de phase.ts passaram.");
