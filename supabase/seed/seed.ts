import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  // Clients
  const { data: clientAlpha } = await supabase
    .from("Client")
    .insert({ name: "TechCorp", email: "contato@techcorp.com.br", notes: "Startup fintech, série A", updatedAt: new Date().toISOString() })
    .select().single();

  const { data: clientBeta } = await supabase
    .from("Client")
    .insert({ name: "RetailMax", email: "ops@retailmax.com", notes: "E-commerce enterprise, migração de legacy", updatedAt: new Date().toISOString() })
    .select().single();

  // Members
  const now = new Date().toISOString();
  const { data: memberAna } = await supabase.from("Member").insert({ name: "Ana Silva", email: "ana@perke.dev", role: "product-builder", specialty: "ux-ui", githubUsername: "anasilva", updatedAt: now }).select().single();
  const { data: memberCarlos } = await supabase.from("Member").insert({ name: "Carlos Mendes", email: "carlos@perke.dev", role: "product-builder", specialty: "backend", githubUsername: "carlosmendes", updatedAt: now }).select().single();
  const { data: memberJoao } = await supabase.from("Member").insert({ name: "João Dev", email: "joao@perke.dev", role: "product-builder", specialty: "fullstack", githubUsername: "joaodev", updatedAt: now }).select().single();

  // Project Alpha
  const { data: projectAlpha } = await supabase.from("Project").insert({
    name: "TechCorp App", repoUrl: "https://github.com/perke/techcorp-app",
    startDate: "2026-04-01", endDate: "2026-06-30",
    clientId: clientAlpha!.id, githubRepoOwner: "perke", githubRepoName: "techcorp-app", githubDefaultBranch: "main", updatedAt: now,
  }).select().single();

  const { data: squadAlpha } = await supabase.from("Squad").insert({ name: "Squad Alpha", updatedAt: now }).select().single();
  await supabase.from("ProjectSquad").insert({ projectId: projectAlpha!.id, squadId: squadAlpha!.id });
  await supabase.from("SquadMember").insert([
    { squadId: squadAlpha!.id, memberId: memberAna!.id },
    { squadId: squadAlpha!.id, memberId: memberCarlos!.id },
  ]);

  // Project Beta
  const { data: projectBeta } = await supabase.from("Project").insert({
    name: "RetailMax Platform", repoUrl: "https://github.com/perke/retailmax-platform",
    startDate: "2026-03-15", endDate: "2026-07-15",
    clientId: clientBeta!.id, githubRepoOwner: "perke", githubRepoName: "retailmax-platform", githubDefaultBranch: "main", updatedAt: now,
  }).select().single();

  const { data: squadBeta } = await supabase.from("Squad").insert({ name: "Squad Beta", updatedAt: now }).select().single();
  await supabase.from("ProjectSquad").insert({ projectId: projectBeta!.id, squadId: squadBeta!.id });
  await supabase.from("SquadMember").insert({ squadId: squadBeta!.id, memberId: memberJoao!.id });

  // Sprints
  const { data: sprintAlpha } = await supabase.from("Sprint").insert({
    name: "Sprint 1", startDate: "2026-04-01", endDate: "2026-04-14", status: "active", projectId: projectAlpha!.id, updatedAt: now,
  }).select().single();

  const { data: sprintBeta } = await supabase.from("Sprint").insert({
    name: "Sprint 1", startDate: "2026-04-01", endDate: "2026-04-14", status: "active", projectId: projectBeta!.id, updatedAt: now,
  }).select().single();

  const tasks = [
    { title: "Landing page hero section", reference: "TASK-001", complexity: "low", scope: "small", status: "done", sprintId: sprintAlpha!.id, projectId: projectAlpha!.id },
    { title: "API de autenticação", reference: "TASK-002", complexity: "medium", scope: "medium", status: "in_progress", sprintId: sprintAlpha!.id, projectId: projectAlpha!.id },
    { title: "Dashboard de transações", reference: "TASK-003", complexity: "high", scope: "large", status: "todo", sprintId: sprintAlpha!.id, projectId: projectAlpha!.id },
    { title: "Notificações por email", reference: "TASK-004", complexity: "medium", scope: "small", status: "backlog", projectId: projectAlpha!.id },
    { title: "Setup infra com Docker", reference: "TASK-005", complexity: "medium", scope: "small", status: "done", sprintId: sprintBeta!.id, projectId: projectBeta!.id },
    { title: "CRUD de produtos", reference: "TASK-006", complexity: "low", scope: "medium", status: "in_progress", sprintId: sprintBeta!.id, projectId: projectBeta!.id },
    { title: "Integração com gateway de pagamento", reference: "TASK-007", complexity: "high", scope: "large", status: "review", sprintId: sprintBeta!.id, projectId: projectBeta!.id },
    { title: "Checkout flow", reference: "TASK-008", complexity: "high", scope: "large", status: "backlog", projectId: projectBeta!.id },
  ];

  for (const task of tasks) {
    await supabase.from("Task").insert({ ...task, updatedAt: now });
  }

  // Task assignments
  const { data: task002 } = await supabase.from("Task").select("id").eq("reference", "TASK-002").single();
  const { data: task006 } = await supabase.from("Task").select("id").eq("reference", "TASK-006").single();

  if (task002) await supabase.from("TaskAssignment").insert({ taskId: task002.id, memberId: memberAna!.id });
  if (task006) await supabase.from("TaskAssignment").insert({ taskId: task006.id, memberId: memberJoao!.id });

  console.log("Seed completed successfully!");
}

main().catch((e) => { console.error(e); process.exit(1); });
