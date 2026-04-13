import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Clients
  const clientAlpha = await prisma.client.create({
    data: {
      name: "TechCorp",
      email: "contato@techcorp.com.br",
      notes: "Startup fintech, série A",
    },
  });

  const clientBeta = await prisma.client.create({
    data: {
      name: "RetailMax",
      email: "ops@retailmax.com",
      notes: "E-commerce enterprise, migração de legacy",
    },
  });

  // Members
  const memberAna = await prisma.member.create({
    data: {
      name: "Ana Silva",
      email: "ana@perke.dev",
      role: "ui-ux-builder",
      githubUsername: "anasilva",
      hourlyCost: 85,
    },
  });

  const memberCarlos = await prisma.member.create({
    data: {
      name: "Carlos Mendes",
      email: "carlos@perke.dev",
      role: "backend-qa-builder",
      githubUsername: "carlosmendes",
      hourlyCost: 95,
    },
  });

  const memberJoao = await prisma.member.create({
    data: {
      name: "João Dev",
      email: "joao@perke.dev",
      role: "fullstack",
      githubUsername: "joaodev",
      hourlyCost: 120,
    },
  });

  // Agents
  const agentClaude = await prisma.agent.create({
    data: {
      name: "Claude Sonnet 4",
      model: "claude-sonnet-4",
      costPerInputToken: 0.000003,
      costPerOutputToken: 0.000015,
    },
  });

  const agentLovable = await prisma.agent.create({
    data: {
      name: "Lovable",
      model: "lovable-v1",
      costPerInputToken: 0,
      costPerOutputToken: 0,
    },
  });

  // Project Alpha
  const projectAlpha = await prisma.project.create({
    data: {
      name: "TechCorp App",
      repoUrl: "https://github.com/perke/techcorp-app",
      startDate: new Date("2026-04-01"),
      endDate: new Date("2026-06-30"),
      clientId: clientAlpha.id,
      githubRepoOwner: "perke",
      githubRepoName: "techcorp-app",
      githubDefaultBranch: "main",
    },
  });

  const squadAlpha = await prisma.squad.create({
    data: {
      name: "Squad Alpha",
      projectSquads: {
        create: [{ projectId: projectAlpha.id }],
      },
      members: {
        create: [
          { memberId: memberAna.id },
          { memberId: memberCarlos.id },
        ],
      },
    },
  });

  // Project Beta
  const projectBeta = await prisma.project.create({
    data: {
      name: "RetailMax Platform",
      repoUrl: "https://github.com/perke/retailmax-platform",
      startDate: new Date("2026-03-15"),
      endDate: new Date("2026-07-15"),
      clientId: clientBeta.id,
      githubRepoOwner: "perke",
      githubRepoName: "retailmax-platform",
      githubDefaultBranch: "main",
    },
  });

  const squadBeta = await prisma.squad.create({
    data: {
      name: "Squad Beta",
      projectSquads: {
        create: [{ projectId: projectBeta.id }],
      },
      members: {
        create: [{ memberId: memberJoao.id }],
      },
    },
  });

  // Sprints
  const sprintAlpha = await prisma.sprint.create({
    data: {
      name: "Sprint 1",
      startDate: new Date("2026-04-01"),
      endDate: new Date("2026-04-14"),
      status: "active",
      projectId: projectAlpha.id,
    },
  });

  const sprintBeta = await prisma.sprint.create({
    data: {
      name: "Sprint 1",
      startDate: new Date("2026-04-01"),
      endDate: new Date("2026-04-14"),
      status: "active",
      projectId: projectBeta.id,
    },
  });

  // Tasks for Alpha
  const tasks = [
    { title: "Landing page hero section", reference: "TASK-001", complexity: "low", scope: "small", status: "done", executionMode: "agent", sprintId: sprintAlpha.id, projectId: projectAlpha.id },
    { title: "Auth flow com magic link", reference: "TASK-002", complexity: "medium", scope: "medium", status: "in_progress", executionMode: "manual", sprintId: sprintAlpha.id, projectId: projectAlpha.id },
    { title: "Dashboard de transações", reference: "TASK-003", complexity: "high", scope: "large", status: "todo", executionMode: "agent", sprintId: sprintAlpha.id, projectId: projectAlpha.id },
    { title: "Integração API de pagamentos", reference: "TASK-004", complexity: "high", scope: "large", status: "backlog", executionMode: "manual", projectId: projectAlpha.id },
    // Tasks for Beta
    { title: "Setup infra com Docker", reference: "TASK-005", complexity: "medium", scope: "small", status: "done", executionMode: "agent", sprintId: sprintBeta.id, projectId: projectBeta.id },
    { title: "CRUD de produtos", reference: "TASK-006", complexity: "low", scope: "medium", status: "in_progress", executionMode: "agent", sprintId: sprintBeta.id, projectId: projectBeta.id },
    { title: "Sistema de busca com filtros", reference: "TASK-007", complexity: "high", scope: "large", status: "todo", executionMode: "manual", sprintId: sprintBeta.id, projectId: projectBeta.id },
    { title: "Checkout flow", reference: "TASK-008", complexity: "high", scope: "large", status: "backlog", executionMode: "agent", projectId: projectBeta.id },
  ];

  for (const task of tasks) {
    await prisma.task.create({ data: task });
  }

  // Task assignments
  const task002 = await prisma.task.findUnique({ where: { reference: "TASK-002" } });
  const task006 = await prisma.task.findUnique({ where: { reference: "TASK-006" } });

  if (task002) {
    await prisma.taskAssignment.create({ data: { taskId: task002.id, memberId: memberAna.id } });
    await prisma.taskAssignment.create({ data: { taskId: task002.id, agentId: agentLovable.id } });
  }

  if (task006) {
    await prisma.taskAssignment.create({ data: { taskId: task006.id, memberId: memberJoao.id } });
    await prisma.taskAssignment.create({ data: { taskId: task006.id, agentId: agentClaude.id } });
  }

  console.log("Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
