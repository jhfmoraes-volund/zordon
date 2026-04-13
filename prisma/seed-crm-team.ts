import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PROJECT_ID = "cmngge4e00002p3j0ab9khnn9";
const SPRINT1 = "sprint-crm-1";
const SPRINT2 = "sprint-crm-2";
const SPRINT3 = "sprint-crm-3";

async function main() {
  // ═══ 1. Create 4 Members ═══════════════════════════════

  const ana = await prisma.member.upsert({
    where: { id: "member-ana" },
    update: {},
    create: {
      id: "member-ana",
      name: "Ana Beatriz",
      email: "ana@perke.dev",
      role: "pm",
      fpCapacity: 20,
      hourlyCost: 120,
    },
  });

  const lucas = await prisma.member.upsert({
    where: { id: "member-lucas" },
    update: {},
    create: {
      id: "member-lucas",
      name: "Lucas Ferreira",
      email: "lucas@perke.dev",
      role: "fullstack",
      fpCapacity: 50,
      hourlyCost: 95,
    },
  });

  const camila = await prisma.member.upsert({
    where: { id: "member-camila" },
    update: {},
    create: {
      id: "member-camila",
      name: "Camila Santos",
      email: "camila@perke.dev",
      role: "ui-ux-builder",
      fpCapacity: 50,
      hourlyCost: 90,
    },
  });

  const rafael = await prisma.member.upsert({
    where: { id: "member-rafael" },
    update: {},
    create: {
      id: "member-rafael",
      name: "Rafael Oliveira",
      email: "rafael@perke.dev",
      role: "backend-qa-builder",
      fpCapacity: 50,
      hourlyCost: 90,
    },
  });

  console.log("✓ 4 membros criados: Ana (PM), Lucas, Camila, Rafael");

  // ═══ 2. Create Squad ═══════════════════════════════════

  const squad = await prisma.squad.upsert({
    where: { id: "squad-crm" },
    update: {},
    create: {
      id: "squad-crm",
      name: "Squad CRM",
    },
  });

  // Link members to squad
  for (const memberId of [ana.id, lucas.id, camila.id, rafael.id]) {
    const existing = await prisma.squadMember.findFirst({
      where: { squadId: squad.id, memberId },
    });
    if (!existing) {
      await prisma.squadMember.create({
        data: { squadId: squad.id, memberId },
      });
    }
  }

  // Link squad to project
  const existingLink = await prisma.projectSquad.findFirst({
    where: { projectId: PROJECT_ID, squadId: squad.id },
  });
  if (!existingLink) {
    await prisma.projectSquad.create({
      data: { projectId: PROJECT_ID, squadId: squad.id },
    });
  }

  console.log("✓ Squad CRM criado e vinculado ao projeto");

  // ═══ 3. Create 12 PM Management Tasks ══════════════════

  const pmTasks = [
    // Sprint 1
    {
      reference: "TASK-025",
      title: "Kickoff e alinhamento com cliente",
      description: "Reuniao de kickoff com MarketPro Solutions. Alinhar expectativas, cronograma, canais de comunicacao (Slack, email), cadencia de demos, e criterios de aceite globais.",
      sprintId: SPRINT1,
      functionPoints: 5,
      dueDate: "2026-04-08",
      acceptanceCriteria: `- [ ] Reuniao de kickoff realizada com stakeholders do cliente
- [ ] Documento de expectativas e DoD alinhado
- [ ] Canais de comunicacao definidos (Slack channel, email list)
- [ ] Cadencia de demos combinada (a cada sprint)
- [ ] Cronograma de 3 sprints apresentado e validado`,
      businessContext: "Primeiro contato formal do projeto. Define o tom da relacao e evita retrabalho por desalinhamento.",
    },
    {
      reference: "TASK-026",
      title: "Setup de board, processos e DoD",
      description: "Configurar o board de tasks no Volund, definir workflow de review (PR → QA → Aceite), definition of done por tipo de task, e template de daily.",
      sprintId: SPRINT1,
      functionPoints: 3,
      dueDate: "2026-04-09",
      acceptanceCriteria: `- [ ] Board no Volund configurado com todas as 24+ tasks
- [ ] Workflow documentado: dev → review → QA → aceite
- [ ] Definition of Done por tipo (feature, component, setup)
- [ ] Template de daily standup definido
- [ ] Criterios de aceite padrão para tasks de componente`,
      businessContext: "Processos claros desde o dia 1 evitam gargalos de comunicacao e retrabalho.",
    },
    {
      reference: "TASK-027",
      title: "Facilitacao e tracking — Sprint 1",
      description: "Conduzir dailies, remover bloqueios, atualizar status das tasks, monitorar velocity e capacity do time durante o Sprint 1.",
      sprintId: SPRINT1,
      functionPoints: 5,
      dueDate: "2026-04-21",
      acceptanceCriteria: `- [ ] Dailies conduzidas (10 sessoes de ~15min)
- [ ] Bloqueios identificados e resolvidos em <24h
- [ ] Status das tasks atualizado no Volund diariamente
- [ ] Burndown/velocity acompanhado
- [ ] Escalonamento proativo se capacity em risco`,
      businessContext: "PM como facilitador garante que o time mantem ritmo e nao trava em dependencias.",
    },
    {
      reference: "TASK-028",
      title: "Review de entrega Release 0",
      description: "Validar que todos os componentes reutilizaveis, schema, auth e layout estao funcionais e atendem os criterios de aceite antes de iniciar as features.",
      sprintId: SPRINT1,
      functionPoints: 3,
      dueDate: "2026-04-19",
      acceptanceCriteria: `- [ ] DataTable, KanbanBoard, StatsCard, ActivityTimeline testados
- [ ] Schema rodando, seed funcional
- [ ] Auth mock funcional (3 usuarios)
- [ ] Layout com sidebar navegavel
- [ ] Checklist de DoD validado para cada task de Release 0
- [ ] Go/no-go para iniciar Release 1`,
      businessContext: "Gate de qualidade entre releases. Seguir com features sobre base fragil gera debito tecnico.",
    },
    // Sprint 2
    {
      reference: "TASK-029",
      title: "Demo parcial + alinhamento com cliente",
      description: "Apresentar progresso de Release 0 e inicio de Release 1 para o cliente. Coletar feedback, validar prioridades, ajustar escopo se necessario.",
      sprintId: SPRINT2,
      functionPoints: 5,
      dueDate: "2026-04-24",
      acceptanceCriteria: `- [ ] Demo preparada (roteiro de 20min)
- [ ] Apresentacao ao vivo para stakeholders
- [ ] Feedback documentado
- [ ] Ajustes de prioridade aplicados se necessario
- [ ] Ata enviada ao cliente em <24h`,
      businessContext: "Demo a cada sprint mantem o cliente engajado e evita surpresas no final.",
    },
    {
      reference: "TASK-030",
      title: "Facilitacao e tracking — Sprint 2",
      description: "Conduzir dailies, remover bloqueios, tracking de Sprint 2. Foco em features de CRUD e pipeline.",
      sprintId: SPRINT2,
      functionPoints: 5,
      dueDate: "2026-05-06",
      acceptanceCriteria: `- [ ] Dailies conduzidas (10 sessoes)
- [ ] Bloqueios resolvidos em <24h
- [ ] Status atualizado diariamente
- [ ] Velocity monitorado vs Sprint 1
- [ ] Risk log atualizado`,
      businessContext: "Sprint 2 tem o maior volume de features interdependentes. PM precisa garantir sequenciamento.",
    },
    {
      reference: "TASK-031",
      title: "QA/Review de features Release 1",
      description: "Validar todas as features de Release 1 contra criterios de aceite: contatos, empresas, pipeline, CSV, tags, follow-ups, config de stages.",
      sprintId: SPRINT2,
      functionPoints: 5,
      dueDate: "2026-05-05",
      acceptanceCriteria: `- [ ] CRUD Contatos: criar, listar, filtrar, buscar — OK
- [ ] CRUD Empresas: criar, editar, deletar — OK
- [ ] Pipeline Kanban: drag-and-drop, filtros, novo deal — OK
- [ ] Import CSV: upload, mapeamento, preview, resultado — OK
- [ ] Export CSV: filtros aplicados, encoding UTF-8 — OK
- [ ] Tags: CRUD, TagPicker funcional — OK
- [ ] Follow-ups: listagem por urgencia, acoes — OK
- [ ] Pipeline Stages: reorder, add, remove — OK
- [ ] Bugs criticos documentados e priorizados`,
      businessContext: "QA antes do Sprint 3 garante que Release 2 parte de uma base solida.",
    },
    {
      reference: "TASK-032",
      title: "Planejamento Sprint 3",
      description: "Refinar tasks de Release 2 com base no andamento real. Ajustar SP, datas e assignments se necessario. Preparar backlog de Sprint 3.",
      sprintId: SPRINT2,
      functionPoints: 3,
      dueDate: "2026-05-06",
      acceptanceCriteria: `- [ ] Tasks de Release 2 refinadas com time
- [ ] SP revalidados com base na velocity real
- [ ] Assignments ajustados por capacity
- [ ] Riscos de Sprint 3 identificados
- [ ] Backlog priorizado e pronto para execucao`,
      businessContext: "Planejamento baseado em dados reais (velocity) ao inves de estimativas iniciais.",
    },
    // Sprint 3
    {
      reference: "TASK-033",
      title: "Demo intermediaria para stakeholders",
      description: "Apresentar Release 1 completo e progresso de Release 2. Demonstrar pipeline, contatos, import CSV ao vivo.",
      sprintId: SPRINT3,
      functionPoints: 5,
      dueDate: "2026-05-09",
      acceptanceCriteria: `- [ ] Demo preparada com dados reais (seed)
- [ ] Roteiro cobrindo: contatos, pipeline, import, tags, follow-ups
- [ ] Apresentacao ao vivo
- [ ] Feedback documentado
- [ ] Decisoes de escopo para itens "next" registradas`,
      businessContext: "Marcos (CEO) precisa ver progresso concreto. Demo com dados reais gera confianca.",
    },
    {
      reference: "TASK-034",
      title: "Facilitacao e tracking — Sprint 3",
      description: "Conduzir dailies, tracking final. Foco em integracao e dashboard.",
      sprintId: SPRINT3,
      functionPoints: 5,
      dueDate: "2026-05-21",
      acceptanceCriteria: `- [ ] Dailies conduzidas (10 sessoes)
- [ ] Bloqueios resolvidos
- [ ] Status atualizado
- [ ] Velocity final calculado
- [ ] Retrospectiva agendada`,
      businessContext: "Ultimo sprint — PM garante que tudo converge para entrega final.",
    },
    {
      reference: "TASK-035",
      title: "QA final e aceite end-to-end",
      description: "Testar o CRM completo end-to-end: criar lead via webhook, ver no pipeline, registrar atividades, gerar score, visualizar no dashboard.",
      sprintId: SPRINT3,
      functionPoints: 5,
      dueDate: "2026-05-19",
      acceptanceCriteria: `- [ ] Fluxo completo testado: webhook → contato → deal → pipeline → dashboard
- [ ] Lead scoring calculando corretamente
- [ ] Dashboard ROI com dados coerentes
- [ ] Import/export CSV funcional
- [ ] Follow-ups com notificacao
- [ ] 3 personas testadas (Carolina, Rafael, Marcos)
- [ ] Lista de bugs criticos = 0
- [ ] Lista de bugs menores documentada para proxima iteracao`,
      businessContext: "Gate final de qualidade antes do handoff. Cliente recebe produto funcional, nao prototipo quebrado.",
    },
    {
      reference: "TASK-036",
      title: "Handoff e documentacao",
      description: "Entregar o CRM para o cliente. Documentar: como rodar, como usar, arquitetura, proximos passos (items 'next' do backlog).",
      sprintId: SPRINT3,
      functionPoints: 5,
      dueDate: "2026-05-21",
      acceptanceCriteria: `- [ ] README.md com instrucoes de setup e uso
- [ ] Documento de arquitetura (schema, rotas, componentes)
- [ ] Guia de uso para cada persona (Carolina, Rafael, Marcos)
- [ ] Backlog de proximos passos priorizado (nurturing, WhatsApp, A/B testing)
- [ ] Reuniao de handoff com cliente realizada
- [ ] Acesso ao repositorio e ambiente entregue`,
      businessContext: "Entrega profissional. Cliente sai com autonomia para usar e evoluir o produto.",
    },
  ];

  for (const t of pmTasks) {
    const existing = await prisma.task.findUnique({ where: { reference: t.reference } });
    const data = {
      title: t.title,
      description: t.description,
      reference: t.reference,
      type: "management",
      scope: "small",
      complexity: "medium",
      functionPoints: t.functionPoints,
      executionMode: "manual",
      status: t.sprintId === SPRINT1 ? "todo" : "backlog",
      projectId: PROJECT_ID,
      sprintId: t.sprintId,
      dueDate: new Date(t.dueDate),
      acceptanceCriteria: t.acceptanceCriteria,
      businessContext: t.businessContext,
    };
    if (existing) {
      await prisma.task.update({ where: { reference: t.reference }, data });
    } else {
      await prisma.task.create({ data: { ...data, reference: t.reference } });
    }
    console.log(`  + ${t.reference}: ${t.title}`);
  }

  console.log("✓ 12 tasks de gestao criadas");

  // ═══ 4. Assign all tasks to members ════════════════════

  // Clear existing assignments for this project's tasks
  const projectTasks = await prisma.task.findMany({
    where: { projectId: PROJECT_ID },
    select: { id: true, reference: true },
  });
  const taskMap = new Map(projectTasks.map((t) => [t.reference, t.id]));

  await prisma.taskAssignment.deleteMany({
    where: { taskId: { in: Array.from(taskMap.values()) } },
  });

  // Assignment map: reference → memberId
  const assignments: Record<string, string> = {
    // ─── Ana (PM) — management tasks only ───
    "TASK-025": ana.id,
    "TASK-026": ana.id,
    "TASK-027": ana.id,
    "TASK-028": ana.id,
    "TASK-029": ana.id,
    "TASK-030": ana.id,
    "TASK-031": ana.id,
    "TASK-032": ana.id,
    "TASK-033": ana.id,
    "TASK-034": ana.id,
    "TASK-035": ana.id,
    "TASK-036": ana.id,

    // ─── Lucas (Fullstack) — infra + backend ───
    // Sprint 1: 37 SP
    "TASK-001": lucas.id, // setup (8)
    "TASK-002": lucas.id, // schema (21)
    "TASK-003": lucas.id, // auth (5)
    "TASK-009": lucas.id, // layout (3)
    // Sprint 3: 21 SP
    "TASK-019": lucas.id, // webhook (8)
    "TASK-021": lucas.id, // lead scoring (13)

    // ─── Camila (UI/UX) — frontend + componentes ───
    // Sprint 1: 41 SP
    "TASK-005": camila.id, // DataTable (13)
    "TASK-006": camila.id, // KanbanBoard (13)
    "TASK-007": camila.id, // StatsCard (5)
    "TASK-008": camila.id, // ActivityTimeline (5)
    "TASK-010": camila.id, // contatos listagem (8) — uses DataTable she built
    // Sprint 3: 24 SP
    "TASK-022": camila.id, // dashboard ROI (21) — uses StatsCard she built
    "TASK-024": camila.id, // campanhas (3)

    // ─── Rafael (Backend/QA) — features + integracoes ───
    // Sprint 1: 11 SP
    "TASK-004": rafael.id, // seed (8)
    "TASK-012": rafael.id, // empresas (3)
    // Sprint 2: 47 SP
    "TASK-011": rafael.id, // detalhe contato (8)
    "TASK-016": rafael.id, // tags (5)
    "TASK-018": rafael.id, // pipeline stages (5)
    "TASK-017": rafael.id, // follow-ups (8)
    "TASK-013": rafael.id, // pipeline kanban (13)
    "TASK-014": rafael.id, // CSV import (13) — wait, this exceeds. Let me check
    "TASK-015": rafael.id, // CSV export (3) — total Sprint 2: 8+5+5+8+13+13+3 = 55. Too much.
    // Sprint 3: 6 SP
    "TASK-020": rafael.id, // mock ads (3)
    "TASK-023": rafael.id, // atividades (3)
  };

  // Redistribute: move TASK-014 (CSV import, 13 FP) from Rafael Sprint 2 to Lucas Sprint 2
  // Lucas Sprint 2 was empty, now 13 SP. Rafael Sprint 2 drops to 42 SP.
  assignments["TASK-014"] = lucas.id;

  let count = 0;
  for (const [ref, memberId] of Object.entries(assignments)) {
    const taskId = taskMap.get(ref);
    if (!taskId) {
      console.warn(`  ⚠ Task ${ref} nao encontrada`);
      continue;
    }
    await prisma.taskAssignment.create({
      data: { taskId, memberId },
    });
    count++;
  }

  console.log(`✓ ${count} assignments criados`);

  // ═══ 5. Verify capacity ════════════════════════════════

  console.log("\n═══ CAPACITY CHECK ═══");

  const members = [
    { member: ana, name: "Ana (PM)", cap: 20 },
    { member: lucas, name: "Lucas", cap: 50 },
    { member: camila, name: "Camila", cap: 50 },
    { member: rafael, name: "Rafael", cap: 50 },
  ];

  const sprintNames: Record<string, string> = {
    [SPRINT1]: "Sprint 1",
    [SPRINT2]: "Sprint 2",
    [SPRINT3]: "Sprint 3",
  };

  for (const { member, name, cap } of members) {
    console.log(`\n${name} (${cap} SP/sprint):`);
    for (const [sprintId, sprintName] of Object.entries(sprintNames)) {
      const tasks = await prisma.taskAssignment.findMany({
        where: { memberId: member.id, task: { sprintId } },
        include: { task: { select: { reference: true, functionPoints: true, title: true } } },
      });
      const totalFp = tasks.reduce((s, a) => s + (a.task.functionPoints ?? 0), 0);
      const pct = Math.round((totalFp / cap) * 100);
      const indicator = pct > 100 ? "🔴" : pct > 85 ? "🟡" : "🟢";
      console.log(`  ${indicator} ${sprintName}: ${totalFp}/${cap} SP (${pct}%) — ${tasks.length} tasks`);
      for (const a of tasks) {
        console.log(`     ${a.task.reference} (${a.task.functionPoints} FP) ${a.task.title}`);
      }
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
