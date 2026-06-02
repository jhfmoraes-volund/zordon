/**
 * Tests for buildSetupStackPrd (QAL-002).
 * Standalone — sem framework, pra rodar via:
 *   npx tsx src/lib/agent/agents/vitor/setup-stack-template.test.ts
 *
 * Cobre:
 *   1. Default (stack-da-casa) parseia contra ProposePrdInput (com ids dummy)
 *   2. Override { framework: "Remix" } reflete no oneLiner/goal/AC
 *   3. PRD-000 é raiz por construção (sem campo de dependência no shape)
 */
import assert from "node:assert/strict";
import { ProposePrdInput } from "./prd-schemas";
import {
  buildSetupStackPrd,
  SetupStackPrdContentSchema,
} from "./setup-stack-template";

const DUMMY_IDS = {
  projectId: "11111111-1111-4111-8111-111111111111",
  designSessionId: "22222222-2222-4222-8222-222222222222",
};

// ─── 1. Default parseia contra o schema canônico ─────────────────────────────
{
  const content = buildSetupStackPrd();

  // Conteúdo bate com o shape que a tool propose_prd aceita.
  SetupStackPrdContentSchema.parse(content);

  // Mesclado com os ids de contexto, passa o ProposePrdInput completo.
  ProposePrdInput.parse({ ...content, ...DUMMY_IDS });

  assert.ok(content.acceptanceCriteria.length >= 3, "AC >= 3");
  assert.ok(content.problem.length >= 50, "problem >= 50");
  assert.ok(content.goal.length >= 20, "goal >= 20");
  assert.match(content.title, /Setup & Stack/);
  // Default = stack-da-casa.
  assert.match(content.oneLiner, /Next\.js/);
  assert.match(content.oneLiner, /Supabase/);
  console.log("✓ 1. default parseia + stack-da-casa");
}

// ─── 2. Override reflete no conteúdo ─────────────────────────────────────────
{
  const content = buildSetupStackPrd({ framework: "Remix" });
  ProposePrdInput.parse({ ...content, ...DUMMY_IDS });

  assert.match(content.oneLiner, /Remix/, "oneLiner reflete override");
  assert.match(content.goal, /Remix/, "goal reflete override");
  const acText = JSON.stringify(content.acceptanceCriteria);
  assert.match(acText, /Remix/, "AC reflete override");
  assert.doesNotMatch(content.oneLiner, /Next\.js/, "oneLiner não mantém default trocado");
  console.log("✓ 2. override { framework: 'Remix' } reflete em oneLiner/goal/AC");
}

// ─── 3. Raiz do DAG por construção ───────────────────────────────────────────
{
  const content = buildSetupStackPrd();
  // ProposePrdInput não carrega arestas de dependência: o shape não tem
  // nenhum campo de dependências — links são criados via link_prd_dependency.
  assert.ok(
    !("dependencies" in content) && !("dependsOn" in content),
    "PRD-000 não declara dependência de saída (raiz)",
  );
  console.log("✓ 3. PRD-000 é raiz (sem dependência de saída)");
}

console.log("\nAll setup-stack-template tests passed.");
