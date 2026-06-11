import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { executeTool, getConnectionStatus } from "@/lib/composio/client";
import { extractTextFromBuffer } from "@/lib/design-session/file-extraction";

type ContextSource = Database["public"]["Tables"]["ContextSource"]["Row"];

export interface ResolvedContent {
  fullText: string;
  snapshotAt: string;
}

export class ComposioConnectionMissing extends Error {
  constructor(
    public toolkit: string,
    public connectUrl?: string
  ) {
    super(`Composio connection missing for toolkit: ${toolkit}`);
    this.name = "ComposioConnectionMissing";
  }
}

/** Cap de texto extraído (runbook D7) — Drive continua SSOT do binário. */
const MAX_TEXT_BYTES = 1_000_000;

const GOOGLE_NATIVE_EXPORT: Record<string, { exportMime: string; ext: string }> = {
  "application/vnd.google-apps.document": {
    exportMime: "text/markdown",
    ext: "md",
  },
  "application/vnd.google-apps.spreadsheet": {
    exportMime: "text/csv",
    ext: "csv",
  },
  "application/vnd.google-apps.presentation": {
    exportMime: "text/plain",
    ext: "txt",
  },
};

/**
 * Google Drive file adapter via Composio (runbook D7) — conta de quem importou
 * (`createdBy`, mesma semântica dos irmãos gsheets/notion).
 *
 *   - Google-native (Doc/Sheet/Slide) → GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE
 *     (markdown/csv/plain).
 *   - Binário (PDF/DOCX/…) → download + pipeline de extração do upload
 *     (extractTextFromBuffer).
 *
 * `externalId` = fileId (dedup key D6); `payload` = { fileId, mimeType, stage }.
 * Resultado persiste em fullText + capturedAt (snapshot) — `force` re-resolve
 * ignorando o cache (usado pelo refresh diário do cron, D13).
 */
export async function resolveContent(
  supabase: SupabaseClient<Database>,
  source: ContextSource,
  opts?: { force?: boolean }
): Promise<ResolvedContent> {
  if (source.fullText && !opts?.force) {
    return {
      fullText: source.fullText,
      snapshotAt: source.capturedAt || source.createdAt,
    };
  }

  if (!source.createdBy) {
    throw new Error(
      `ContextSource ${source.id} sem createdBy — não pode resolver conexão Composio`
    );
  }
  const fileId = source.externalId;
  if (!fileId) {
    throw new Error(`ContextSource ${source.id} sem externalId (fileId do Drive)`);
  }

  const status = await getConnectionStatus(source.createdBy, "googledrive");
  if (status.status !== "active") {
    const appUrl = process.env.APP_URL || "http://localhost:3000";
    const connectUrl = `${appUrl}/api/integrations/composio/connect?toolkit=googledrive`;
    throw new ComposioConnectionMissing("googledrive", connectUrl);
  }

  const payload = (source.payload ?? {}) as { mimeType?: string };
  const mimeType = payload.mimeType ?? "";

  const text = GOOGLE_NATIVE_EXPORT[mimeType]
    ? await exportGoogleNative(source.createdBy, fileId, mimeType, source.id)
    : await downloadAndExtract(
        source.createdBy,
        fileId,
        source.title,
        mimeType,
        source.id
      );

  const fullText = truncateText(text, MAX_TEXT_BYTES);
  const snapshotAt = new Date().toISOString();

  // Cache best-effort: leitura não pode falhar porque o write falhou.
  const { error: cacheError } = await supabase
    .from("ContextSource")
    .update({
      fullText,
      capturedAt: snapshotAt,
      updatedAt: snapshotAt,
    })
    .eq("id", source.id);
  if (cacheError) {
    console.warn(
      `[drive-adapter] cache de fullText falhou (source ${source.id}): ${cacheError.message}`
    );
  }

  return { fullText, snapshotAt };
}

/** Doc/Sheet/Slide → export texto via Composio. Shape defensivo (toolkit evolui). */
async function exportGoogleNative(
  userId: string,
  fileId: string,
  mimeType: string,
  sourceId: string
): Promise<string> {
  const { exportMime } = GOOGLE_NATIVE_EXPORT[mimeType];
  const result = await executeTool(
    userId,
    "GOOGLEDRIVE_EXPORT_GOOGLE_WORKSPACE_FILE",
    { file_id: fileId, mime_type: exportMime }
  );
  if (!result.ok) {
    throw new Error(
      `Export do Drive falhou (${mimeType} → ${exportMime}): ${result.error} (source ${sourceId})`
    );
  }
  const text = await extractTextPayload(result.data);
  if (text === null) {
    console.error(
      `[drive-adapter] shape inesperado do export (source ${sourceId}):`,
      JSON.stringify(result.data).slice(0, 2000)
    );
    throw new Error(
      `Export do Drive retornou shape inesperado — ver logs (source ${sourceId})`
    );
  }
  return text;
}

/** PDF/DOCX/etc → download + extração reusando o pipeline do upload. */
async function downloadAndExtract(
  userId: string,
  fileId: string,
  filename: string,
  mimeType: string,
  sourceId: string
): Promise<string> {
  const result = await executeTool(userId, "GOOGLEDRIVE_DOWNLOAD_FILE", {
    file_id: fileId,
  });
  if (!result.ok) {
    throw new Error(
      `Download do Drive falhou: ${result.error} (source ${sourceId})`
    );
  }
  const buffer = await extractBinaryPayload(result.data);
  if (!buffer) {
    console.error(
      `[drive-adapter] shape inesperado do download (source ${sourceId}):`,
      JSON.stringify(result.data).slice(0, 2000)
    );
    throw new Error(
      `Download do Drive retornou shape inesperado — ver logs (source ${sourceId})`
    );
  }
  const extraction = await extractTextFromBuffer(buffer, filename, mimeType);
  if (extraction.status === "unsupported") {
    return `[Formato não suportado pra extração de texto: ${mimeType || filename}]`;
  }
  if (extraction.status === "failed") {
    throw new Error(
      `Extração de texto falhou para ${filename} (source ${sourceId})`
    );
  }
  return extraction.text;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Composio normaliza payloads de formas diferentes — varre os shapes comuns
 * de texto exportado (string direta, campos aninhados, file wrapper).
 */
async function extractTextPayload(data: unknown): Promise<string | null> {
  const d = data as any;
  if (typeof d === "string") return d;
  if (!d) return null;
  const candidates = [
    d.content,
    d.text,
    d.data,
    d.exported_content,
    d.file_content,
    d.response_data,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  // Wrapper de arquivo (s3url/uri) — alguns tools devolvem o export como file.
  const fileObj = d.file ?? d.downloaded_file ?? d.s3file;
  const buffer = await fetchFileWrapper(fileObj ?? d);
  return buffer ? buffer.toString("utf-8") : null;
}

/** Shapes comuns de binário: base64 inline ou URL (s3url/uri) pra baixar. */
async function extractBinaryPayload(data: unknown): Promise<Buffer | null> {
  const d = data as any;
  if (!d) return null;
  const base64 =
    typeof d.base64 === "string"
      ? d.base64
      : typeof d.content === "string" && d.encoding === "base64"
        ? d.content
        : typeof d.file_content === "string"
          ? d.file_content
          : null;
  if (base64) {
    try {
      return Buffer.from(base64, "base64");
    } catch {
      return null;
    }
  }
  const fileObj = d.file ?? d.downloaded_file ?? d.s3file ?? d;
  return fetchFileWrapper(fileObj);
}

/** Baixa um wrapper { s3url | uri | url } pra Buffer. */
async function fetchFileWrapper(obj: any): Promise<Buffer | null> {
  const url =
    typeof obj?.s3url === "string"
      ? obj.s3url
      : typeof obj?.uri === "string" && obj.uri.startsWith("http")
        ? obj.uri
        : typeof obj?.url === "string" && obj.url.startsWith("http")
          ? obj.url
          : null;
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** Cap por bytes UTF-8 sem quebrar surrogate pairs no meio. */
function truncateText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) return text;
  const buf = Buffer.from(text, "utf-8").subarray(0, maxBytes);
  const truncated = buf.toString("utf-8").replace(/�+$/, "");
  return `${truncated}\n\n[Conteúdo truncado em 1MB — arquivo completo no Drive.]`;
}
