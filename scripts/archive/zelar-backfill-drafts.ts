/**
 * zelar-backfill-drafts.ts — parseia o backup de turn-12 (cards densos que
 * iam viajar como texto na ChatMessage e travaram o chat) e popula
 * DesignSessionStepData[brainstorm]._drafts[] da session Zelar.
 *
 * Apos rodar, Vitor consegue:
 *   - review_draft({}) -> ve os 36 cards
 *   - apply_drafts({}) -> move tudo pra solutions[] num unico tool call
 *
 * One-shot. Idempotente: se rodar de novo, REESCREVE _drafts[] (nao acumula).
 *
 * Uso direto via tsx — bypassa src/lib/db.ts (server-only) e usa supabase-js
 * com service role key direto.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const SESSION_ID = "ae1c4107-14e3-4d6a-9b63-e2d0969691d5";
const BACKUP_PATH = join(__dirname, "..", ".local-backups", "zelar-turn-12-full.md");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface ParsedCard {
  title: string;
  howItSolves: string;
  targetPersona: string;
  keyScreens?: string;
  userFlows?: string;
  painPointRef?: string;
  technicalNotes?: string;
}

interface DraftCard extends ParsedCard {
  id: string;
  draftedAt: string;
}

const FIELD_ORDER = [
  "howItSolves",
  "targetPersona",
  "painPointRef",
  "keyScreens",
  "userFlows",
  "technicalNotes",
] as const;

function genDraftId(): string {
  return `draft_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Splits a card chunk into fields by `**fieldName:**` markers.
 * Each field's value runs from the marker to the next marker (or end).
 */
function parseCardFields(body: string): Partial<ParsedCard> {
  const fields: Partial<ParsedCard> = {};
  // Index where each known field marker starts
  const markers: Array<{ name: typeof FIELD_ORDER[number]; start: number; end: number }> = [];
  for (const name of FIELD_ORDER) {
    const marker = `**${name}:**`;
    const idx = body.indexOf(marker);
    if (idx >= 0) {
      markers.push({ name, start: idx, end: idx + marker.length });
    }
  }
  markers.sort((a, b) => a.start - b.start);
  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i];
    const next = markers[i + 1];
    const sliceEnd = next ? next.start : body.length;
    const value = body.slice(cur.end, sliceEnd).trim();
    fields[cur.name] = value;
  }
  return fields;
}

function parseBackup(md: string): ParsedCard[] {
  // Cards open with `### ` (h3). BLOCO headers are h2 (`## BLOCO`) — skip them.
  const cards: ParsedCard[] = [];
  // Split by lines that start with "### " — keep the heading with the body
  const parts = md.split(/^### (?=[A-Z]{1,3}[0-9]+ —)/gm);
  for (const part of parts) {
    if (!part.match(/^[A-Z]{1,3}[0-9]+ —/)) continue;
    const lines = part.split("\n");
    const heading = lines[0].trim(); // e.g. "C1 — Cadastro e Login do Cliente"
    const body = lines.slice(1).join("\n");
    const fields = parseCardFields(body);
    if (!fields.howItSolves || !fields.targetPersona) {
      console.warn(`Skipping card with missing required fields: ${heading.slice(0, 40)}`);
      continue;
    }
    cards.push({
      title: heading,
      howItSolves: fields.howItSolves,
      targetPersona: fields.targetPersona,
      keyScreens: fields.keyScreens || undefined,
      userFlows: fields.userFlows || undefined,
      painPointRef: fields.painPointRef || undefined,
      technicalNotes: fields.technicalNotes || undefined,
    });
  }
  return cards;
}

async function main() {
  const md = readFileSync(BACKUP_PATH, "utf-8");
  const parsed = parseBackup(md);
  console.log(`Parsed ${parsed.length} cards from backup.`);
  if (parsed.length === 0) {
    console.error("No cards parsed — abort.");
    process.exit(1);
  }

  // Tag a draftedAt timestamp matching when the original message was created
  const draftedAt = new Date().toISOString();
  const drafts: DraftCard[] = parsed.map((c) => ({
    id: genDraftId(),
    draftedAt,
    ...c,
  }));

  // Read existing brainstorm step data
  const { data: existing, error: readErr } = await sb
    .from("DesignSessionStepData")
    .select("id, data")
    .eq("sessionId", SESSION_ID)
    .eq("stepKey", "brainstorm")
    .maybeSingle();

  if (readErr) {
    console.error("Read failed:", readErr);
    process.exit(1);
  }

  const baseData = (existing?.data as Record<string, unknown>) || {};
  const newData = { ...baseData, _drafts: drafts };

  if (existing) {
    const { error } = await sb
      .from("DesignSessionStepData")
      .update({ data: newData, updatedAt: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) {
      console.error("Update failed:", error);
      process.exit(1);
    }
  } else {
    const { error } = await sb.from("DesignSessionStepData").insert({
      id: crypto.randomUUID(),
      sessionId: SESSION_ID,
      stepKey: "brainstorm",
      stepIndex: 0,
      data: newData,
      updatedAt: new Date().toISOString(),
    });
    if (error) {
      console.error("Insert failed:", error);
      process.exit(1);
    }
  }

  console.log(`✓ Persistido em DesignSessionStepData[${SESSION_ID}, brainstorm]._drafts`);
  console.log(`  ${drafts.length} cards staged. Titles:`);
  for (const d of drafts) {
    console.log(`  - ${d.title.slice(0, 80)}`);
  }
  const existingSolutions =
    (baseData.solutions as Array<{ id: string; title: string }> | undefined) ?? [];
  console.log(
    `  (solutions[] preservadas: ${existingSolutions.length} cards aplicados anteriormente)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
