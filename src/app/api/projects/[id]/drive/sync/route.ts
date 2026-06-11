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
 *   Desce exatamente 1 nível (runbook D3): raiz + conteúdo das 4 pastas
 *   canônicas (Comercial/Imersão/Ops/Pós-Ops → stage). As pastas canônicas
 *   não viram card; seus filhos herdam o stage. Demais arquivos: stage NULL.
 *
 *   200 { files, syncedAt, truncated, missingStages }
 *   409 sem driveFolderId · 412 { connectUrl } sem auth-config/conexão · 502 erro Drive
 *   Cap: 200 na raiz + 100 por pasta canônica (D4) — acima, truncated=true.
 */

const PAGE_SIZE = 100;
const MAX_ROOT_FILES = 200;
const MAX_STAGE_FILES = 100;

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

  // ── Raiz ──────────────────────────────────────────────────
  const root = await listChildren(linkedBy, project.driveFolderId, MAX_ROOT_FILES);
  if (!root.ok) {
    return NextResponse.json(
      { error: `Drive list falhou: ${root.error}` },
      { status: 502 }
    );
  }
  let truncated = root.truncated;

  // ── Pastas canônicas: 1 nível abaixo, filhos herdam stage ─
  const stageFolders = new Map<DriveStage, string>();
  for (const f of root.files) {
    if (f.mimeType !== FOLDER_MIME || !f.id || !f.name) continue;
    const stage = folderStage(f.name);
    // Primeira ocorrência ganha — duas pastas com mesmo nome canônico é
    // estado degenerado no Drive, não vale recursão dupla.
    if (stage && !stageFolders.has(stage)) stageFolders.set(stage, f.id);
  }
  const missingStages = STAGE_ORDER.filter((s) => !stageFolders.has(s));

  const staged: Array<{ file: DriveApiFile; stage: DriveStage }> = [];
  for (const [stage, folderId] of stageFolders) {
    const children = await listChildren(linkedBy, folderId, MAX_STAGE_FILES);
    if (!children.ok) {
      return NextResponse.json(
        { error: `Drive list falhou (pasta ${stage}): ${children.error}` },
        { status: 502 }
      );
    }
    truncated = truncated || children.truncated;
    staged.push(...children.files.map((file) => ({ file, stage })));
  }

  // Pastas canônicas não viram card; raiz fica com stage NULL.
  const canonicalIds = new Set(stageFolders.values());
  const entries: Array<{ file: DriveApiFile; stage: DriveStage | null }> = [
    ...root.files
      .filter((f) => !f.id || !canonicalIds.has(f.id))
      .map((file) => ({ file, stage: null })),
    ...staged,
  ];

  const syncedAt = new Date().toISOString();
  const seen = new Set<string>();
  const normalized = entries
    .filter((e): e is { file: DriveApiFile & { id: string }; stage: DriveStage | null } =>
      Boolean(e.file.id)
    )
    // Drive permite multi-parent: dedup por fileId (staged entra por último e
    // o reverse abaixo faz o staged ganhar do root em caso de duplicata).
    .reverse()
    .filter((e) => {
      if (seen.has(e.file.id)) return false;
      seen.add(e.file.id);
      return true;
    })
    .map(({ file: f, stage }) => {
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
