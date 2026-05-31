/**
 * Tests for parsePrdMarkdown.
 * Standalone — sem framework, pra rodar via:
 *   npx tsx src/lib/sessions/prd-session/parser.test.ts
 *
 * Cobre 3 PRDs de exemplo:
 *   1. PRD completo (título + problema + AC)
 *   2. PRD sem AC (deve retornar AC vazio, sem warning — AC é opcional)
 *   3. PRD sem título (deve ter warning + título default)
 */
import assert from "node:assert/strict";
import { parsePrdMarkdown } from "./parser";

// ─── PRD 1: Completo ────────────────────────────────────────────────────────

const prd1 = `
# PRD — User Authentication

> Quick login with email/password and OAuth providers.

## 1 · Problema

1. **Sem autenticação** — app não tem controle de acesso.
2. **Onboarding manual** — PM precisa adicionar users no banco.

## 2 · Solução em uma frase

Sistema de auth com email/senha + OAuth (Google, GitHub) usando Supabase Auth.

## 3 · Não-objetivos

- Não suporta SAML (enterprise SSO vem depois).

## 16 · Stories implementáveis

### AUTH-001: Setup Supabase Auth

**Description:**
Enable Supabase Auth in project config.

**Acceptance Criteria:**
- Supabase Auth enabled in dashboard
- Email provider configured
- Google OAuth configured
- Test user can sign up and log in

**Estimate:** 20 min
`;

{
  const result = parsePrdMarkdown(prd1);

  assert.equal(result.title, "PRD — User Authentication");
  assert.equal(result.oneLiner, "Sistema de auth com email/senha + OAuth (Google, GitHub) usando Supabase Auth.");
  assert.ok(result.problem?.includes("Sem autenticação"));
  assert.ok(result.problem?.includes("Onboarding manual"));
  assert.equal(result.acceptanceCriteria.length, 4);
  assert.ok(result.acceptanceCriteria.includes("Supabase Auth enabled in dashboard"));
  assert.ok(result.acceptanceCriteria.includes("Test user can sign up and log in"));
  assert.equal(result.warnings.length, 0);
}

// ─── PRD 2: Sem Acceptance Criteria ─────────────────────────────────────────

const prd2 = `
# PRD — Dark Mode

## 1 · Problema

Users want dark mode for better UX at night.

## 2 · Solução em uma frase

Toggle dark mode in settings, persisted to localStorage.
`;

{
  const result = parsePrdMarkdown(prd2);

  assert.equal(result.title, "PRD — Dark Mode");
  assert.equal(result.oneLiner, "Toggle dark mode in settings, persisted to localStorage.");
  assert.ok(result.problem?.includes("Users want dark mode"));
  assert.equal(result.acceptanceCriteria.length, 0, "AC should be empty array when not present");
  assert.equal(result.warnings.length, 0, "No warnings for missing AC — it's optional per D5");
}

// ─── PRD 3: Sem título (deve ter warning) ───────────────────────────────────

const prd3 = `
Some intro text without H1.

## 1 · Problema

This PRD is missing a proper title.

## Acceptance Criteria

- Parser should handle this gracefully
- Title should be "Untitled PRD"
- Warning should be present
`;

{
  const result = parsePrdMarkdown(prd3);

  assert.equal(result.title, "Untitled PRD");
  assert.ok(result.problem?.includes("This PRD is missing a proper title"));
  assert.equal(result.acceptanceCriteria.length, 3);
  assert.ok(result.acceptanceCriteria.includes("Parser should handle this gracefully"));
  assert.ok(result.acceptanceCriteria.includes("Title should be \"Untitled PRD\""));
  assert.ok(result.acceptanceCriteria.includes("Warning should be present"));
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes("Missing title"));
}

// ─── PRD 4: AC em seção dedicada (case-insensitive) ─────────────────────────

const prd4 = `
# PRD — API Rate Limiting

## 1 · Problem

APIs need rate limiting to prevent abuse.

## Acceptance Criteria

- Rate limit: 100 req/min per user
- Return 429 status when exceeded
- X-RateLimit-* headers in response

## Other section

Some other content.
`;

{
  const result = parsePrdMarkdown(prd4);

  assert.equal(result.title, "PRD — API Rate Limiting");
  assert.equal(result.acceptanceCriteria.length, 3);
  assert.ok(result.acceptanceCriteria.includes("Rate limit: 100 req/min per user"));
  assert.ok(result.acceptanceCriteria.includes("Return 429 status when exceeded"));
  assert.ok(result.acceptanceCriteria.includes("X-RateLimit-* headers in response"));
  assert.equal(result.warnings.length, 0);
}

// ─── PRD 5: AC com acento (Critérios de Aceitação) ──────────────────────────

const prd5 = `
# PRD — Notificações Push

## Critérios de Aceitação

- Push notifications habilitadas
- Usuário pode desabilitar nas configs
`;

{
  const result = parsePrdMarkdown(prd5);

  assert.equal(result.title, "PRD — Notificações Push");
  assert.equal(result.acceptanceCriteria.length, 2);
  assert.ok(result.acceptanceCriteria.includes("Push notifications habilitadas"));
  assert.ok(result.acceptanceCriteria.includes("Usuário pode desabilitar nas configs"));
}

console.log("✓ Todos os testes de parsePrdMarkdown passaram.");
