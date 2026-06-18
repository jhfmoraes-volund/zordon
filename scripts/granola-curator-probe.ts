import "dotenv/config";
import { getMemberGranolaClient } from "../src/lib/member-integrations";

// Validação do MODELO CURADOR (runbook pm-review-granola-folder + memory
// project_ritual_playbook, ⚠️ VALIDAR): com o token do member-curador (João),
// (a) o token enxerga as folders bindadas? (b) as notas aparecem nelas?
// (c) aparecem notas cujo OWNER != João (notas que outra pessoa arquivou numa
//     folder compartilhada)? Se sim → modelo curador confirmado.
//
//   NODE_OPTIONS='--conditions=react-server' pnpm tsx scripts/granola-curator-probe.ts
//
// memberId = curador (dc4d91f5) tirado das bindings em ProjectGranolaFolder.

const CURATOR_MEMBER_ID = "dc4d91f5-0d29-453a-b11e-d42dd6a7b158";

// Snapshot das 8 bindings (SELECT ... FROM "ProjectGranolaFolder").
const BOUND_FOLDERS: { folderId: string; name: string }[] = [
  { folderId: "fol_iEnhqm6T72jYy0", name: "SILFAE" },
  { folderId: "fol_mxV4wS9E9k2LFR", name: "ALLOS" },
  { folderId: "fol_fzjkZsJJPhqb2R", name: "Escalas Médicas" },
  { folderId: "fol_Gequz8ietT3SID", name: "HITZ" },
  { folderId: "fol_4ndbmd5a9D8yqS", name: "PGF" },
  { folderId: "fol_O1kfkSGYYpyYPZ", name: "Riple 1" },
  { folderId: "fol_jM0gCF62zDDeoV", name: "Riple 2" },
  { folderId: "fol_yq8DX1bmqsAATi", name: "SIAL" },
];

async function main() {
  const client = await getMemberGranolaClient(CURATOR_MEMBER_ID);
  if (!client) {
    console.error(
      `✖ member ${CURATOR_MEMBER_ID} não tem token Granola conectado (member-integrations).`,
    );
    process.exit(1);
  }

  console.log("▶ (a) Folders que o token do curador enxerga:\n");
  const folders = await client.listAllFolders();
  console.log(`${folders.length} folder(s):`);
  for (const f of folders) console.log(`   • ${f.name || "(sem nome)"}  [${f.id}]`);

  const visible = new Set(folders.map((f) => f.id));
  console.log("\n▶ (b)/(c) Notas por folder bindada (owner de cada nota):\n");

  const owners = new Set<string>();
  for (const b of BOUND_FOLDERS) {
    const seenByToken = visible.has(b.folderId) ? "" : "  ⚠️ NÃO listada pelo token";
    let line = `── ${b.name} [${b.folderId}]${seenByToken}`;
    try {
      const res = await client.listNotes({ folderId: b.folderId, limit: 20 });
      line += `  → ${res.notes.length} nota(s)${res.hasMore ? "+" : ""}`;
      console.log(line);
      for (const n of res.notes.slice(0, 5)) {
        const who = n.owner?.name || n.owner?.email || "(owner desconhecido)";
        owners.add(who);
        console.log(`     · "${n.title ?? "(sem título)"}"  — owner: ${who}  (${n.created_at})`);
      }
    } catch (e) {
      console.log(`${line}  ✖ ${(e as Error).message}`);
    }
  }

  console.log("\n▶ Veredito do modelo curador:");
  console.log(`   owners distintos vistos nas folders: ${[...owners].join(", ") || "nenhum"}`);
  console.log(
    "   → se há ≥1 nota com owner != João numa folder compartilhada, o token-curador",
  );
  console.log("     enxerga notas de terceiros ⇒ MODELO CURADOR CONFIRMADO.");
}

main().catch((e) => {
  console.error("✖", e);
  process.exit(1);
});
