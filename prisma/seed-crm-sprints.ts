import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PROJECT_ID = "cmngge4e00002p3j0ab9khnn9";

async function main() {
  // ─── Create 3 Sprints ───────────────────────────────────
  const sprint1 = await prisma.sprint.upsert({
    where: { id: "sprint-crm-1" },
    update: {},
    create: {
      id: "sprint-crm-1",
      name: "Sprint 1 — Fundação",
      projectId: PROJECT_ID,
      startDate: new Date("2026-04-07"),
      endDate: new Date("2026-04-21"),
      status: "active",
    },
  });

  const sprint2 = await prisma.sprint.upsert({
    where: { id: "sprint-crm-2" },
    update: {},
    create: {
      id: "sprint-crm-2",
      name: "Sprint 2 — Base + Pipeline",
      projectId: PROJECT_ID,
      startDate: new Date("2026-04-22"),
      endDate: new Date("2026-05-06"),
      status: "planning",
    },
  });

  const sprint3 = await prisma.sprint.upsert({
    where: { id: "sprint-crm-3" },
    update: {},
    create: {
      id: "sprint-crm-3",
      name: "Sprint 3 — Captura + Visibilidade",
      projectId: PROJECT_ID,
      startDate: new Date("2026-05-07"),
      endDate: new Date("2026-05-21"),
      status: "planning",
    },
  });

  console.log("✓ 3 sprints criados");

  // ─── Task assignments with due dates ────────────────────
  // Organized by dependency order within each sprint
  //
  // Sprint 1 (Apr 7-21): Release 0 — Fundação (81 SP)
  //   Week 1 (Apr 7-13): Setup, Schema, Components (parallelizable)
  //   Week 2 (Apr 14-21): Auth, Seed, Layout + start Release 1
  //
  // Sprint 2 (Apr 22 - May 6): Release 1 — Base + Pipeline (66 SP)
  //   Week 1: Contatos, Empresas, Tags, Follow-ups
  //   Week 2: Pipeline, Import/Export CSV, Config stages
  //
  // Sprint 3 (May 7-21): Release 2 — Captura + Visibilidade (51 SP)
  //   Week 1: Webhook, Mock ads, Lead scoring, Atividades
  //   Week 2: Dashboard ROI, Campanhas

  const assignments: { ref: string; sprintId: string; dueDate: string }[] = [
    // ═══ Sprint 1 — Fundação ═══
    // Sem dependencias - podem comecar dia 1
    { ref: "TASK-001", sprintId: sprint1.id, dueDate: "2026-04-09" }, // Setup (2 dias)
    { ref: "TASK-005", sprintId: sprint1.id, dueDate: "2026-04-11" }, // DataTable (depende TASK-001, mas pode paralelizar)
    { ref: "TASK-006", sprintId: sprint1.id, dueDate: "2026-04-11" }, // KanbanBoard
    { ref: "TASK-007", sprintId: sprint1.id, dueDate: "2026-04-10" }, // StatsCard + MiniChart
    { ref: "TASK-008", sprintId: sprint1.id, dueDate: "2026-04-10" }, // ActivityTimeline

    // Depende de TASK-001
    { ref: "TASK-002", sprintId: sprint1.id, dueDate: "2026-04-14" }, // Schema (começa apos setup, leva ~3 dias)

    // Depende de TASK-002
    { ref: "TASK-004", sprintId: sprint1.id, dueDate: "2026-04-16" }, // Seed (apos schema)

    // Depende de TASK-001 + TASK-002
    { ref: "TASK-003", sprintId: sprint1.id, dueDate: "2026-04-16" }, // Auth (apos schema)

    // Depende de TASK-001 + TASK-003
    { ref: "TASK-009", sprintId: sprint1.id, dueDate: "2026-04-18" }, // Layout (apos auth)

    // Começo antecipado Release 1 — depende de TASK-005 + TASK-009
    { ref: "TASK-010", sprintId: sprint1.id, dueDate: "2026-04-21" }, // CRUD Contatos
    { ref: "TASK-012", sprintId: sprint1.id, dueDate: "2026-04-21" }, // CRUD Empresas

    // ═══ Sprint 2 — Base + Pipeline ═══
    // Depende de TASK-008 + TASK-010
    { ref: "TASK-011", sprintId: sprint2.id, dueDate: "2026-04-25" }, // Detalhe Contato

    // Depende de TASK-002 + TASK-009
    { ref: "TASK-016", sprintId: sprint2.id, dueDate: "2026-04-25" }, // Tags
    { ref: "TASK-018", sprintId: sprint2.id, dueDate: "2026-04-25" }, // Pipeline Stages config

    // Depende de TASK-002 + TASK-005 + TASK-009
    { ref: "TASK-017", sprintId: sprint2.id, dueDate: "2026-04-28" }, // Follow-ups

    // Depende de TASK-002 + TASK-006 + TASK-009
    { ref: "TASK-013", sprintId: sprint2.id, dueDate: "2026-04-30" }, // Pipeline Kanban

    // Depende de TASK-002 + TASK-010
    { ref: "TASK-014", sprintId: sprint2.id, dueDate: "2026-05-04" }, // Import CSV

    // Depende de TASK-010
    { ref: "TASK-015", sprintId: sprint2.id, dueDate: "2026-05-04" }, // Export CSV

    // ═══ Sprint 3 — Captura + Visibilidade ═══
    // Depende de TASK-002 + TASK-010
    { ref: "TASK-019", sprintId: sprint3.id, dueDate: "2026-05-09" }, // Webhook capture

    // Depende de TASK-019
    { ref: "TASK-020", sprintId: sprint3.id, dueDate: "2026-05-11" }, // Mock ads

    // Depende de TASK-002 + TASK-011
    { ref: "TASK-021", sprintId: sprint3.id, dueDate: "2026-05-13" }, // Lead Scoring

    // Depende de TASK-005 + TASK-009
    { ref: "TASK-023", sprintId: sprint3.id, dueDate: "2026-05-12" }, // Atividades
    { ref: "TASK-024", sprintId: sprint3.id, dueDate: "2026-05-12" }, // Campanhas

    // Depende de TASK-002 + TASK-007 + TASK-009 — task mais complexa (21 SP)
    { ref: "TASK-022", sprintId: sprint3.id, dueDate: "2026-05-20" }, // Dashboard ROI
  ];

  for (const a of assignments) {
    await prisma.task.update({
      where: { reference: a.ref },
      data: {
        sprintId: a.sprintId,
        dueDate: new Date(a.dueDate),
        status: a.sprintId === sprint1.id ? "todo" : "backlog",
      },
    });
    console.log(`  ✓ ${a.ref} → ${a.sprintId === sprint1.id ? "Sprint 1" : a.sprintId === sprint2.id ? "Sprint 2" : "Sprint 3"} (due ${a.dueDate})`);
  }

  console.log("\n✓ 24 tasks distribuidas em 3 sprints com datas de entrega");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
