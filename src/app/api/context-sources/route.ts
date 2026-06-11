/**
 * POST /api/context-sources
 * Cria um novo ContextSource (CSV upload, GSheets, GitHub).
 * Body varia por kind. Validação Zod garante shape correto.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActorMemberId } from "@/lib/dal";
import { extractTextFromBuffer } from "@/lib/design-session/file-extraction";
import * as driveAdapter from "@/lib/context-sources/adapters/drive";
import { z } from "zod";

// Schema Zod para CSV upload
const CSVCreateSchema = z.object({
  kind: z.literal("spreadsheet_csv"),
  title: z.string().min(1),
  projectId: z.string().uuid(),
  file: z.string().describe("Base64-encoded CSV file content"),
});

// Schema Zod para upload de documento genérico (PDF/DOCX/CSV/XLSX/TXT/...).
const DocumentCreateSchema = z.object({
  kind: z.literal("document"),
  title: z.string().min(1),
  projectId: z.string().uuid(),
  file: z.string().describe("Base64-encoded file content"),
  filename: z.string().min(1),
  mimeType: z.string().default(""),
});

// Schema Zod para GSheets
const GSheetsCreateSchema = z.object({
  kind: z.literal("spreadsheet_gsheets"),
  title: z.string().min(1),
  projectId: z.string().uuid(),
  externalUrl: z.string().url().describe("Google Sheets URL"),
});

// Schema Zod para GitHub
const GitHubCreateSchema = z.object({
  kind: z.enum(["github_repo", "github_pr", "github_issue"]),
  title: z.string().min(1),
  projectId: z.string().uuid(),
  externalUrl: z.string().url().describe("GitHub URL"),
});

// Schema Zod para Notion (página ou base)
const NotionCreateSchema = z.object({
  kind: z.literal("notion"),
  title: z.string().min(1),
  projectId: z.string().uuid(),
  externalUrl: z.string().url().describe("Notion page/database URL"),
});

// Schema Zod para arquivo do Drive (import explícito da aba Drive — D5).
// Metadata (title/mimeType/stage) vem do índice ProjectDriveFile do projeto.
const GDriveFileCreateSchema = z.object({
  kind: z.literal("gdrive_file"),
  projectId: z.string().uuid(),
  fileId: z.string().min(1).describe("Drive fileId (já sincronizado no índice)"),
});

const CreateContextSourceSchema = z.discriminatedUnion("kind", [
  CSVCreateSchema,
  DocumentCreateSchema,
  GSheetsCreateSchema,
  GitHubCreateSchema,
  NotionCreateSchema,
  GDriveFileCreateSchema,
]);

export async function POST(req: NextRequest) {
  const memberId = await getActorMemberId();
  if (!memberId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse and validate body
  const body = await req.json().catch(() => null);
  const parsed = CreateContextSourceSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const supabase = db();

  try {
    // Handle CSV file upload
    if (data.kind === "spreadsheet_csv") {
      // Decode base64 file
      const fileBuffer = Buffer.from(data.file, "base64");

      // Create ContextSource record first
      const { data: source, error: sourceError } = await supabase
        .from("ContextSource")
        .insert({
          kind: data.kind,
          title: data.title,
          projectId: data.projectId,
          createdBy: memberId,
          payload: {},
        })
        .select()
        .single();

      if (sourceError || !source) {
        throw new Error(sourceError?.message || "Failed to create ContextSource");
      }

      // Upload file to storage bucket
      const { error: uploadError } = await supabase.storage
        .from("context-source-files")
        .upload(source.id, fileBuffer, {
          contentType: "text/csv",
          upsert: false,
        });

      if (uploadError) {
        // Rollback: delete the ContextSource record
        await supabase.from("ContextSource").delete().eq("id", source.id);
        throw new Error(`Failed to upload file: ${uploadError.message}`);
      }

      return NextResponse.json({ id: source.id, kind: source.kind, title: source.title });
    }

    // Handle generic document upload (PDF/DOCX/CSV/XLSX/TXT/...).
    // Extracts text on upload and caches it in fullText so agents read it via
    // read_context_source. Raw file is kept in storage for eventual download.
    if (data.kind === "document") {
      const fileBuffer = Buffer.from(data.file, "base64");
      const extraction = await extractTextFromBuffer(
        fileBuffer,
        data.filename,
        data.mimeType,
      );
      const summary =
        extraction.status === "success"
          ? null
          : extraction.status === "unsupported"
            ? "Formato não suportado — conteúdo não extraído."
            : "Falha ao extrair o conteúdo do arquivo.";

      const { data: source, error: sourceError } = await supabase
        .from("ContextSource")
        .insert({
          kind: data.kind,
          title: data.title,
          projectId: data.projectId,
          createdBy: memberId,
          fullText: extraction.text || null,
          source: data.mimeType || null,
          summary,
          capturedAt: new Date().toISOString(),
          payload: {},
        })
        .select()
        .single();

      if (sourceError || !source) {
        throw new Error(sourceError?.message || "Failed to create ContextSource");
      }

      const { error: uploadError } = await supabase.storage
        .from("context-source-files")
        .upload(source.id, fileBuffer, {
          contentType: data.mimeType || "application/octet-stream",
          upsert: false,
        });

      if (uploadError) {
        await supabase.from("ContextSource").delete().eq("id", source.id);
        throw new Error(`Failed to upload file: ${uploadError.message}`);
      }

      return NextResponse.json({ id: source.id, kind: source.kind, title: source.title });
    }

    // Handle Drive file import (metadata vem do índice; texto extraído na hora)
    if (data.kind === "gdrive_file") {
      const { data: driveFile, error: driveFileError } = await supabase
        .from("ProjectDriveFile")
        .select("fileId, name, mimeType, stage, webViewLink")
        .eq("projectId", data.projectId)
        .eq("fileId", data.fileId)
        .maybeSingle();
      if (driveFileError) throw new Error(driveFileError.message);
      if (!driveFile) {
        return NextResponse.json(
          { error: "Arquivo não está no índice do Drive — sincronize a aba Drive primeiro" },
          { status: 404 },
        );
      }

      // Dedup por (kind, externalId=fileId, projectId) — D6: reimport devolve
      // o existente, não duplica.
      const { data: existing, error: existingError } = await supabase
        .from("ContextSource")
        .select("id, kind, title")
        .eq("kind", "gdrive_file")
        .eq("externalId", data.fileId)
        .eq("projectId", data.projectId)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (existing) {
        return NextResponse.json({ ...existing, existing: true });
      }

      const { data: source, error: sourceError } = await supabase
        .from("ContextSource")
        .insert({
          kind: data.kind,
          title: driveFile.name,
          projectId: data.projectId,
          externalId: data.fileId,
          externalUrl: driveFile.webViewLink,
          createdBy: memberId,
          payload: {
            fileId: data.fileId,
            mimeType: driveFile.mimeType,
            stage: driveFile.stage,
          },
        })
        .select()
        .single();
      if (sourceError || !source) {
        throw new Error(sourceError?.message || "Failed to create ContextSource");
      }

      // Extrai o texto já no import (mesma semântica do kind document) — o
      // adapter persiste fullText + capturedAt. Falhou → rollback da row.
      try {
        await driveAdapter.resolveContent(supabase, source);
      } catch (err) {
        await supabase.from("ContextSource").delete().eq("id", source.id);
        if (err instanceof driveAdapter.ComposioConnectionMissing) {
          return NextResponse.json(
            { error: "Conexão Google Drive necessária", connectUrl: err.connectUrl },
            { status: 412 },
          );
        }
        throw err;
      }

      return NextResponse.json({
        id: source.id,
        kind: source.kind,
        title: source.title,
        existing: false,
      });
    }

    // Handle GSheets or GitHub (no file upload needed)
    const { data: source, error: sourceError } = await supabase
      .from("ContextSource")
      .insert({
        kind: data.kind,
        title: data.title,
        projectId: data.projectId,
        externalUrl: data.externalUrl,
        createdBy: memberId,
        payload: {},
      })
      .select()
      .single();

    if (sourceError || !source) {
      throw new Error(sourceError?.message || "Failed to create ContextSource");
    }

    return NextResponse.json({ id: source.id, kind: source.kind, title: source.title });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
