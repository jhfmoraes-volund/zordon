import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";
import { executeTool, getConnectionStatus } from "@/lib/composio/client";

/**
 * POST /api/projects/[id]/drive/sync
 *   Lista os filhos diretos da pasta Drive linkada (via Composio, connected
 *   account de driveLinkedBy) e espelha em ProjectDriveFile (upsert + delete
 *   dos que sumiram). Drive é o SSOT — só metadata entra no banco.
 *
 *   200 { files, syncedAt, truncated }
 *   409 sem driveFolderId · 412 { connectUrl } sem auth-config/conexão · 502 erro Drive
 *   Cap: 200 arquivos (2 páginas de 100) — acima disso truncated=true.
 */

const PAGE_SIZE = 100;
const MAX_FILES = 200;

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

  // ── Lista paginada via Composio ───────────────────────────
  const collected: DriveApiFile[] = [];
  let pageToken: string | undefined;
  let truncated = false;

  while (collected.length < MAX_FILES) {
    const result = await executeTool(linkedBy, "GOOGLEDRIVE_FIND_FILE", {
      query: `'${project.driveFolderId}' in parents and trashed = false`,
      pageSize: PAGE_SIZE,
      ...(pageToken ? { pageToken } : {}),
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: `Drive list falhou: ${result.error}` },
        { status: 502 }
      );
    }
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
  if (pageToken && collected.length >= MAX_FILES) truncated = true;

  const syncedAt = new Date().toISOString();
  const normalized = collected
    .filter((f): f is DriveApiFile & { id: string } => Boolean(f.id))
    .slice(0, MAX_FILES)
    .map((f) => {
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

  return NextResponse.json({ files: files ?? [], syncedAt, truncated });
}
