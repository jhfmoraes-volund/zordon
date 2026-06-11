import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";
import { executeTool, getConnectionStatus } from "@/lib/composio/client";
import { folderStage, STAGE_ORDER, type DriveStage } from "@/lib/drive/stage";

/**
 * POST /api/projects/[id]/drive/sync
 *   Lista a pasta Drive linkada (via Composio, connected account de
 *   driveLinkedBy) e espelha em ProjectDriveFile (upsert + delete dos que
 *   sumiram). Drive é o SSOT — só metadata entra no banco.
 *
 *   Desce a árvore em BFS (Fase 1.5 — supersede D10): cada linha guarda
 *   parentId (NULL = filho direto da raiz) pra UI navegar pelo índice sem
 *   chamar o Google. Pastas canônicas (Comercial/Imersão/Ops/Pós-Ops) viram
 *   linha como qualquer outra; elas e seus descendentes carregam o stage.
 *
 *   200 { files, syncedAt, truncated, missingStages }
 *   409 sem driveFolderId · 412 { connectUrl } sem auth-config/conexão · 502 erro Drive
 *   Caps: profundidade 4 · 200 por pasta · 1000 total — acima, truncated=true.
 */

const PAGE_SIZE = 100;
const MAX_DEPTH = 4;
const MAX_FOLDER_FILES = 200;
const MAX_TOTAL_FILES = 1000;

type DriveApiFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string | number;
  modifiedTime?: string;
  webViewLink?: string;
};

const FOLDER_MIME = "application/vnd.google-apps.folder";

function fallbackWebViewLink(fileId: string, mimeType: string): string {
  return mimeType === FOLDER_MIME
    ? `https://drive.google.com/drive/folders/${fileId}`
    : `https://drive.google.com/file/d/${fileId}/view`;
}

/** Lista filhos diretos de uma pasta, paginado, com cap. */
async function listChildren(
  linkedBy: string,
  folderId: string,
  cap: number
): Promise<
  | { ok: true; files: DriveApiFile[]; truncated: boolean }
  | { ok: false; error: string }
> {
  const collected: DriveApiFile[] = [];
  let pageToken: string | undefined;

  while (collected.length < cap) {
    const result = await executeTool(linkedBy, "GOOGLEDRIVE_FIND_FILE", {
      query: `'${folderId}' in parents and trashed = false`,
      pageSize: PAGE_SIZE,
      ...(pageToken ? { pageToken } : {}),
    });
    if (!result.ok) return { ok: false, error: result.error };
    // Shape defensivo — toolkit em evolução (~89 tools, schemas mudam)
    const data = result.data as {
      files?: DriveApiFile[];
      results?: DriveApiFile[];
      nextPageToken?: string;
    };
    const page = data.files ?? data.results ?? [];
    collected.push(...page);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return {
    ok: true,
    files: collected.slice(0, cap),
    truncated: Boolean(pageToken && collected.length >= cap),
  };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const supabase = db();

  const { data: project, error: projectError } = await supabase
    .from("Project")
    .select("driveFolderId, driveLinkedBy")
    .eq("id", id)
    .maybeSingle();
  if (projectError) {
    return NextResponse.json({ error: projectError.message }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!project.driveFolderId) {
    return NextResponse.json(
      { error: "Projeto sem pasta do Drive configurada" },
      { status: 409 }
    );
  }

  // Sync roda com o connected account de quem linkou a pasta (runbook D3) —
  // qualquer membro pode disparar sem ter Drive conectado.
  const linkedBy = project.driveLinkedBy;
  // Relativo de propósito: resolve no domínio onde o usuário está (local/prod).
  const connectUrl = "/settings/integrations";

  if (!process.env.COMPOSIO_GDRIVE_AUTH_CONFIG_ID || !linkedBy) {
    return NextResponse.json(
      {
        error: !linkedBy
          ? "Pasta sem dono do sync — re-salve a pasta no Editar projeto"
          : "COMPOSIO_GDRIVE_AUTH_CONFIG_ID ausente — configure o Auth Config do Drive",
        connectUrl,
      },
      { status: 412 }
    );
  }

  const status = await getConnectionStatus(linkedBy, "googledrive");
  if (status.status !== "active") {
    return NextResponse.json(
      {
        error: "Dono do sync sem conexão Google Drive ativa",
        connectUrl,
      },
      { status: 412 }
    );
  }

  // ── BFS a partir da raiz ──────────────────────────────────
  // parentId NULL = filho direto da pasta linkada. Pastas no nível raiz com
  // nome canônico definem o stage; descendentes herdam. Dedup por fileId
  // (Drive permite multi-parent) — BFS garante que o nível mais raso ganha.
  type QueueItem = {
    folderId: string;
    depth: number;
    stage: DriveStage | null;
  };

  const queue: QueueItem[] = [
    { folderId: project.driveFolderId, depth: 0, stage: null },
  ];
  const seen = new Set<string>();
  const rootFolderNames: string[] = [];
  const entries: Array<{ file: DriveApiFile & { id: string }; parentId: string | null; stage: DriveStage | null }> = [];
  let truncated = false;

  while (queue.length > 0 && entries.length < MAX_TOTAL_FILES) {
    const node = queue.shift()!;
    const cap = Math.min(MAX_FOLDER_FILES, MAX_TOTAL_FILES - entries.length);
    const children = await listChildren(linkedBy, node.folderId, cap);
    if (!children.ok) {
      return NextResponse.json(
        { error: `Drive list falhou: ${children.error}` },
        { status: 502 }
      );
    }
    truncated = truncated || children.truncated;

    for (const f of children.files) {
      if (!f.id || seen.has(f.id)) continue;
      seen.add(f.id);

      const isFolder = f.mimeType === FOLDER_MIME;
      if (isFolder && node.depth === 0 && f.name) rootFolderNames.push(f.name);

      // Pasta canônica no nível raiz inaugura o stage; o resto herda.
      const stage =
        isFolder && node.depth === 0 && f.name
          ? (folderStage(f.name) ?? node.stage)
          : node.stage;

      const parentId = node.depth === 0 ? null : node.folderId;
      entries.push({ file: f as DriveApiFile & { id: string }, parentId, stage });

      if (isFolder) {
        if (node.depth + 1 < MAX_DEPTH) {
          queue.push({ folderId: f.id, depth: node.depth + 1, stage });
        } else {
          // Pasta no limite de profundidade: conteúdo fica fora do índice.
          truncated = true;
        }
      }
    }
  }
  if (queue.length > 0) truncated = true;

  const missingStages = STAGE_ORDER.filter(
    (s) => !rootFolderNames.some((name) => folderStage(name) === s)
  );

  const syncedAt = new Date().toISOString();
  const normalized = entries.map(({ file: f, parentId, stage }) => {
    const mimeType = f.mimeType ?? "application/octet-stream";
    return {
      projectId: id,
      fileId: f.id,
      name: f.name ?? "(sem nome)",
      mimeType,
      sizeBytes: f.size != null ? Number(f.size) || null : null,
      modifiedTime: f.modifiedTime ?? null,
      webViewLink: f.webViewLink ?? fallbackWebViewLink(f.id, mimeType),
      iconHint: mimeType === FOLDER_MIME ? "folder" : null,
      parentId,
      stage,
      syncedAt,
    };
  });

  // ── Espelha no índice: upsert + delete dos ausentes ──────
  if (normalized.length > 0) {
    const { error: upsertError } = await supabase
      .from("ProjectDriveFile")
      .upsert(normalized, { onConflict: "projectId,fileId" });
    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }
  }

  const keepIds = normalized.map((f) => f.fileId);
  const deleteQuery = supabase
    .from("ProjectDriveFile")
    .delete()
    .eq("projectId", id);
  const { error: deleteError } = await (keepIds.length > 0
    ? deleteQuery.not("fileId", "in", `(${keepIds.map((k) => `"${k}"`).join(",")})`)
    : deleteQuery);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const { data: files, error: filesError } = await supabase
    .from("ProjectDriveFile")
    .select("*")
    .eq("projectId", id)
    .order("mimeType")
    .order("name");
  if (filesError) {
    return NextResponse.json({ error: filesError.message }, { status: 500 });
  }

  return NextResponse.json({
    files: files ?? [],
    syncedAt,
    truncated,
    missingStages,
  });
}
