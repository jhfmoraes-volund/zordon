import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * FP matrix: scope × complexity
 * Based on IFPUG weight ranges adapted for task-level estimation.
 */
const FP_MATRIX: Record<string, Record<string, number>> = {
  micro:  { trivial: 3, low: 4,  medium: 5,  high: 7  },
  small:  { trivial: 4, low: 5,  medium: 7,  high: 10 },
  medium: { trivial: 5, low: 7,  medium: 10, high: 15 },
  large:  { trivial: 7, low: 10, medium: 15, high: 21 },
};

function suggestFP(scope: string, complexity: string): number {
  return FP_MATRIX[scope]?.[complexity] ?? 7;
}

async function main() {
  // ─── Migrate tasks ─────────────────────────────────────
  const tasks = await prisma.task.findMany();
  console.log(`Migrando ${tasks.length} tasks...`);

  for (const t of tasks) {
    const fp = suggestFP(t.scope, t.complexity);
    await prisma.task.update({
      where: { id: t.id },
      data: { functionPoints: fp },
    });
    console.log(`  ${t.reference}: ${t.scope}×${t.complexity} → ${fp} FP`);
  }

  // ─── Migrate members ───────────────────────────────────
  // Squad delivers 500 FP/sprint. Distribution:
  // PM: 50 FP, UI/UX: 125 FP, Backend/QA: 125 FP, Fullstack: 150 FP, Tech Specialist: 60 FP
  const fpByRole: Record<string, number> = {
    pm: 50,
    "ui-ux-builder": 125,
    "backend-qa-builder": 125,
    fullstack: 150,
    "tech-specialist": 60,
  };

  const members = await prisma.member.findMany();
  console.log(`\nMigrando ${members.length} membros...`);

  for (const m of members) {
    const fp = fpByRole[m.role] ?? 125;
    await prisma.member.update({
      where: { id: m.id },
      data: { fpCapacity: fp },
    });
    console.log(`  ${m.name} (${m.role}): ${fp} FP/sprint`);
  }

  // ─── Verify totals ─────────────────────────────────────
  console.log("\n═══ VERIFICACAO ═══");

  const sprintIds = ["sprint-crm-1", "sprint-crm-2", "sprint-crm-3"];
  for (const sprintId of sprintIds) {
    const sprint = await prisma.sprint.findUnique({ where: { id: sprintId } });
    if (!sprint) continue;

    const sprintTasks = await prisma.task.findMany({
      where: { sprintId },
      select: { reference: true, functionPoints: true },
    });
    const totalFp = sprintTasks.reduce((s, t) => s + (t.functionPoints ?? 0), 0);
    console.log(`${sprint.name}: ${totalFp} FP (${sprintTasks.length} tasks)`);
  }

  const allTasks = await prisma.task.findMany({ select: { functionPoints: true } });
  const grandTotal = allTasks.reduce((s, t) => s + (t.functionPoints ?? 0), 0);
  console.log(`\nTotal projeto: ${grandTotal} FP`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
