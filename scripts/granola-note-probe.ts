import "dotenv/config";
import { getMemberGranolaClient } from "../src/lib/member-integrations";

// Diagnóstico: por que a nota "SILFAE - Sync" entrou órfã? O roteamento do
// import (resolveProjectForNote) lê detail.folder_membership do getNote. Se isso
// vier vazio mesmo a nota estando numa folder (visível via listNotes folder_id),
// o roteamento via folder_membership está furado → trocar pelo listNotes-by-folder.
//
//   NODE_OPTIONS='--conditions=react-server' pnpm tsx scripts/granola-note-probe.ts <noteId>

const CURATOR_MEMBER_ID = "dc4d91f5-0d29-453a-b11e-d42dd6a7b158";
const NOTE_ID = process.argv[2] || "not_qPsneT6m2xlDsG";
const SILFAE_FOLDER = "fol_iEnhqm6T72jYy0";

async function main() {
  const client = await getMemberGranolaClient(CURATOR_MEMBER_ID);
  if (!client) {
    console.error("✖ sem token Granola pro curador");
    process.exit(1);
  }

  console.log(`▶ getNote(${NOTE_ID}) — folder_membership:`);
  const detail = await client.getNote(NOTE_ID, { includeTranscript: false }).catch((e) => {
    console.error("  ✖ getNote falhou:", (e as Error).message);
    return null;
  });
  console.log("   title:", detail?.title ?? "(?)");
  console.log("   folder_membership:", JSON.stringify(detail?.folder_membership ?? null));

  console.log(`\n▶ controle: a nota aparece em listNotes(folder=SILFAE)?`);
  const res = await client.listNotes({ folderId: SILFAE_FOLDER, limit: 50 });
  const hit = res.notes.find((n) => n.id === NOTE_ID);
  console.log(`   ${hit ? "SIM — está na folder SILFAE" : "não encontrada na folder"} (${res.notes.length} nota(s) na folder)`);

  console.log("\n▶ Conclusão:");
  if (hit && !(detail?.folder_membership && detail.folder_membership.length)) {
    console.log("   getNote.folder_membership VAZIO embora a nota esteja na folder.");
    console.log("   → roteamento via folder_membership está furado. Usar listNotes(folderId).");
  } else if (hit) {
    console.log("   folder_membership populado — roteamento deveria ter funcionado; investigar map/member.");
  } else {
    console.log("   nota não está na folder SILFAE — caso diferente.");
  }
}

main().catch((e) => {
  console.error("✖", e);
  process.exit(1);
});
