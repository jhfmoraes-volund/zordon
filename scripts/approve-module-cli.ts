/**
 * approve-module-cli.ts
 *
 * Simula o "clique do PM em Aprovar" no UI. Roda a mesma transação que o
 * endpoint POST /api/modules/[id]/approve faz: marca approvedAt, promove
 * tasks draft→backlog, e insere ModuleActivity.
 *
 * Existe pra que o orquestrador (Claude/Alpha) consiga aprovar módulos sem
 * precisar de servidor Next + cookies de auth. Vitor não tem essa tool —
 * ele só tem `approve_module` que marca approvedAt mas não promove tasks.
 *
 * Usage:
 *   bun x tsx --require ./scripts/_server-only-shim.cjs scripts/approve-module-cli.ts \
 *     --project-key EVZL --module KYC_VERIFICACAO_DE_PRESTADORES \
 *     --member-id dc4d91f5-0d29-453a-b11e-d42dd6a7b158
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { promoteTasksForModule } from "../src/lib/dal/story-hierarchy";

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith("--")) {
        out[key] = val;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectKey = args["project-key"];
  const moduleName = args["module"];
  const memberId = args["member-id"];

  if (!projectKey || !moduleName || !memberId) {
    console.error(
      "Uso: --project-key EVZL --module NOME_MODULE --member-id <uuid>",
    );
    process.exit(1);
  }

  const supabase = db();

  const projRes = await supabase
    .from("Project")
    .select("id, referenceKey")
    .eq("referenceKey", projectKey)
    .maybeSingle();
  if (projRes.error || !projRes.data) {
    console.error(`Project ${projectKey} nao encontrado.`);
    process.exit(1);
  }
  const projectId = projRes.data.id;

  const modRes = await supabase
    .from("Module")
    .select("id, name, approvedAt")
    .eq("projectId", projectId)
    .eq("name", moduleName)
    .maybeSingle();
  if (modRes.error || !modRes.data) {
    console.error(`Module ${moduleName} nao encontrado em ${projectKey}.`);
    process.exit(1);
  }
  const moduleId = modRes.data.id;

  const wasAlreadyApproved = !!modRes.data.approvedAt;
  const nowIso = new Date().toISOString();

  if (!wasAlreadyApproved) {
    const { error: updErr } = await supabase
      .from("Module")
      .update({
        approvedAt: nowIso,
        approvedBy: memberId,
        updatedAt: nowIso,
      })
      .eq("id", moduleId);
    if (updErr) {
      console.error("Erro marcando approvedAt:", updErr.message);
      process.exit(1);
    }
  }

  const { promoted, totalFp } = await promoteTasksForModule(moduleId);

  await supabase.from("ModuleActivity").insert({
    moduleId,
    type: "approved",
    payload: { promoted, totalFp, viaScript: "approve-module-cli" },
    actorMemberId: memberId,
  });

  console.log(
    JSON.stringify(
      {
        success: true,
        moduleId,
        moduleName,
        wasAlreadyApproved,
        promoted,
        totalFp,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
