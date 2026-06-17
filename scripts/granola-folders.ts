import "dotenv/config";
import { GranolaClient } from "../src/lib/granola";

// Fase 0 do runbook pm-review-granola-folder: confirma que o token enxerga
// o endpoint /folders (v1.1.0). 404 aqui = bloqueante, pausa o runbook.
//
//   NODE_OPTIONS='--conditions=react-server' pnpm tsx scripts/granola-folders.ts
//
// (a condition react-server faz o `import "server-only"` de granola.ts virar
//  no-op fora do bundler do Next; sem ela o tsx aborta.)

async function main() {
  const apiKey = process.env.GRANOLA_KEY?.trim();
  if (!apiKey) {
    console.error("GRANOLA_KEY missing in .env");
    process.exit(1);
  }

  const client = new GranolaClient(apiKey);

  console.log("▶ Granola — listando folders…\n");
  const folders = await client.listAllFolders();
  console.log(`${folders.length} folder(s) encontrada(s).\n`);

  // imprime hierarquia rasa (parent_folder_id → indent)
  const byParent = new Map<string | null, typeof folders>();
  for (const f of folders) {
    const key = f.parent_folder_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(f);
  }
  const printLevel = (parent: string | null, depth: number) => {
    for (const f of byParent.get(parent) ?? []) {
      console.log(`${"  ".repeat(depth)}• ${f.name || "(sem nome)"}  [${f.id}]`);
      printLevel(f.id, depth + 1);
    }
  };
  printLevel(null, 0);
}

main().catch((e) => {
  console.error("✖", e);
  process.exit(1);
});
