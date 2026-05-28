/**
 * Remove drafts duplicados — qualquer draft cujo title bate (insensitive,
 * normalizado) com um title já presente em solutions[] sai.
 */
import "dotenv/config";
import { db } from "../src/lib/db";

const SESSION_ID = "ae1c4107-14e3-4d6a-9b63-e2d0969691d5";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function main() {
  const { data: row } = await db()
    .from("DesignSessionStepData")
    .select("id, data")
    .eq("sessionId", SESSION_ID)
    .eq("stepKey", "brainstorm")
    .maybeSingle();

  if (!row) throw new Error("brainstorm step data not found");

  const data = row.data as Record<string, unknown>;
  const solutions = (data.solutions as Array<{ title: string }>) || [];
  const drafts = (data._drafts as Array<{ id: string; title: string }>) || [];

  const solutionTitles = new Set(solutions.map((s) => normalize(s.title)));
  const beforeCount = drafts.length;

  const filteredDrafts = drafts.filter((d) => !solutionTitles.has(normalize(d.title)));
  const removed = beforeCount - filteredDrafts.length;

  console.log(`Solutions: ${solutions.length}`);
  console.log(`Drafts antes: ${beforeCount}`);
  console.log(`Drafts removidos (duplicatas): ${removed}`);
  console.log(`Drafts depois: ${filteredDrafts.length}`);
  console.log("\nDrafts mantidos (não aplicados ainda):");
  filteredDrafts.forEach((d, i) => console.log(`  ${i + 1}. ${d.title}`));

  const newData = { ...data, _drafts: filteredDrafts };

  const { error } = await db()
    .from("DesignSessionStepData")
    .update({ data: newData, updatedAt: new Date().toISOString() })
    .eq("id", row.id);

  if (error) throw error;
  console.log("\n✓ Dedup persistido.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
