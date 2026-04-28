/**
 * Migra os 36 cards do backup .local-backups/zelar-turn-12-full.md
 * pro campo brainstorm._drafts[] da sessão Zelar.
 *
 * Parser de markdown — formato:
 *   ### XX — title
 *   **howItSolves:** ...
 *   **targetPersona:** ...
 *   **painPointRef:** ...
 *   **keyScreens:** ...
 *   **userFlows:** ... (multilinha bullet)
 *   **technicalNotes:** ...
 *   ---
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../src/lib/db";

const SESSION_ID = "ae1c4107-14e3-4d6a-9b63-e2d0969691d5";
const BACKUP_PATH = join(__dirname, "..", ".local-backups", "zelar-turn-12-full.md");

interface Draft {
  id: string;
  draftedAt: string;
  title: string;
  howItSolves: string;
  targetPersona: string;
  painPointRef?: string;
  keyScreens?: string;
  userFlows?: string;
  technicalNotes?: string;
}

function genId() {
  return Math.random().toString(36).slice(2, 9);
}

function parseCards(md: string): Omit<Draft, "id" | "draftedAt">[] {
  // Split em blocos por header `### XX — title`
  const blocks: string[] = [];
  const lines = md.split("\n");
  let current: string[] = [];
  let inBlock = false;

  for (const line of lines) {
    if (/^###\s+[A-Z]+\d+\s+—/.test(line)) {
      if (inBlock) blocks.push(current.join("\n"));
      current = [line];
      inBlock = true;
    } else if (inBlock) {
      // Para no próximo `## BLOCO` (header maior) — começa novo bloco grande
      if (/^##\s+BLOCO/.test(line)) {
        blocks.push(current.join("\n"));
        current = [];
        inBlock = false;
      } else {
        current.push(line);
      }
    }
  }
  if (inBlock && current.length) blocks.push(current.join("\n"));

  return blocks.map(parseOneCard).filter((c): c is Omit<Draft, "id" | "draftedAt"> => c !== null);
}

function parseOneCard(block: string): Omit<Draft, "id" | "draftedAt"> | null {
  // title da primeira linha: `### XX — title`
  const titleMatch = block.match(/^###\s+[A-Z]+\d+\s+—\s+(.+)$/m);
  if (!titleMatch) return null;
  const title = titleMatch[1].trim();

  const extractField = (label: string, isMultiline = false): string | undefined => {
    if (isMultiline) {
      // Pega tudo após `**label:**` até o próximo `**xxx:**` ou `---` ou final
      const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*\\n?([\\s\\S]*?)(?=\\n\\*\\*\\w+:\\*\\*|\\n---|$)`);
      const m = block.match(re);
      return m ? m[1].trim() : undefined;
    } else {
      // Single line após `**label:**`
      const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]+(?:\\n(?!\\*\\*\\w+:\\*\\*|---).+)*)`);
      const m = block.match(re);
      return m ? m[1].trim() : undefined;
    }
  };

  const howItSolves = extractField("howItSolves") || "";
  const targetPersona = extractField("targetPersona") || "";
  const painPointRef = extractField("painPointRef");
  const keyScreens = extractField("keyScreens", true);
  const userFlows = extractField("userFlows", true);
  const technicalNotes = extractField("technicalNotes");

  if (!howItSolves || !targetPersona) {
    console.warn(`⚠ Card "${title}" sem howItSolves ou targetPersona — pulando`);
    return null;
  }

  return {
    title,
    howItSolves,
    targetPersona,
    painPointRef,
    keyScreens,
    userFlows,
    technicalNotes,
  };
}

async function main() {
  const md = readFileSync(BACKUP_PATH, "utf-8");
  const parsed = parseCards(md);
  console.log(`Cards parseados: ${parsed.length}`);
  for (const c of parsed) {
    console.log(`  • ${c.title} (${c.targetPersona})`);
  }

  if (parsed.length === 0) {
    console.error("Nenhum card parseado. Saindo sem alterar DB.");
    process.exit(1);
  }

  const now = new Date().toISOString();
  const drafts: Draft[] = parsed.map((c) => ({
    id: genId(),
    draftedAt: now,
    ...c,
  }));

  // Read existing brainstorm step data
  const { data: row } = await db()
    .from("DesignSessionStepData")
    .select("id, data")
    .eq("sessionId", SESSION_ID)
    .eq("stepKey", "brainstorm")
    .maybeSingle();

  if (!row) {
    console.error("Step data brainstorm nao existe. Esperado depois dos add_items P1-P7.");
    process.exit(1);
  }

  const existingData = (row.data as Record<string, unknown>) || {};
  const existingDrafts = (existingData._drafts as Draft[]) || [];

  const newData = {
    ...existingData,
    _drafts: [...existingDrafts, ...drafts],
  } as Record<string, unknown>;

  const { error } = await db()
    .from("DesignSessionStepData")
    .update({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: newData as any,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", row.id);

  if (error) {
    console.error("Erro ao atualizar:", error);
    process.exit(1);
  }

  console.log(`\n✓ ${drafts.length} drafts persistidos em brainstorm._drafts[]`);
  console.log(`  Total drafts atual: ${existingDrafts.length + drafts.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
