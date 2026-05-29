/**
 * POST /api/planning/[id]/sources/spreadsheet
 *   Importa uma planilha (XLSX/XLS/CSV) como TranscriptRef de source='spreadsheet'.
 *   Arquivo original vai pro bucket `planning-sources`; markdown extraído
 *   vai pro fullText (consumido pela tool `read_transcript_content` da Vitória).
 *
 *   Body: multipart/form-data com campo "file".
 *   Limite: 25 MB (mesmo do bucket).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentMember, requireProjectViewApi } from "@/lib/dal";
import {
  getPlanningById,
  findOrCreateTranscriptRef,
  linkTranscriptToPlanning,
} from "@/lib/dal/planning";
import {
  extractTextFromBuffer,
  isOverSizeLimit,
} from "@/lib/design-session/file-extraction";

const BUCKET = "planning-sources";

const ACCEPTED_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "text/csv",
  "application/csv",
  "text/plain", // alguns navegadores mandam CSV como text/plain
]);

const ACCEPTED_EXTS = [".xlsx", ".xls", ".csv"];

function hasAcceptedExt(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTS.some((ext) => lower.endsWith(ext));
}

function sanitizeFilename(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 200);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: planningId } = await params;

  const planning = await getPlanningById(planningId);
  if (!planning) {
    return NextResponse.json({ error: "Planning não encontrada" }, { status: 404 });
  }
  const denied = await requireProjectViewApi(planning.projectId);
  if (denied) return denied;

  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data obrigatório" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "campo 'file' obrigatório" }, { status: 400 });
  }

  const mimeType = file.type || "application/octet-stream";
  if (!ACCEPTED_MIMES.has(mimeType) && !hasAcceptedExt(file.name)) {
    return NextResponse.json(
      { error: `Tipo não suportado. Aceitos: ${ACCEPTED_EXTS.join(", ")}` },
      { status: 415 },
    );
  }

  if (isOverSizeLimit(file.size)) {
    return NextResponse.json(
      { error: `Arquivo excede o limite de 25 MB` },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const extraction = await extractTextFromBuffer(buffer, file.name, mimeType);

  if (extraction.status !== "success" || !extraction.text.trim()) {
    return NextResponse.json(
      { error: "Não foi possível extrair conteúdo da planilha." },
      { status: 422 },
    );
  }

  // Path convention espelha design-session-files: {planningId}/{uuid}/{name}
  const fileId = crypto.randomUUID();
  const storagePath = `${planningId}/${fileId}/${sanitizeFilename(file.name)}`;

  const supabase = db();
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: mimeType, upsert: false });
  if (uploadErr) {
    return NextResponse.json(
      { error: `Falha ao subir arquivo: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  try {
    const ref = await findOrCreateTranscriptRef({
      source: "spreadsheet",
      sourceId: storagePath, // único pelo path; unique index ignora sourceId null
      fullText: extraction.text,
      title: file.name,
      capturedAt: new Date().toISOString(),
      importedById: member.id,
      storagePath,
    });

    await linkTranscriptToPlanning({
      planningCeremonyId: planningId,
      transcriptRefId: ref.id,
      linkedById: member.id,
    });

    return NextResponse.json(
      { id: ref.id, title: ref.title, source: ref.source, storagePath },
      { status: 201 },
    );
  } catch (err) {
    // Best-effort: limpa o objeto do Storage se a row falhar.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    const msg = String(err);
    if (msg.includes("duplicate key") || msg.includes("23505")) {
      return NextResponse.json(
        { error: "Planilha já linkada a esta planning" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Falha ao importar planilha", detail: msg },
      { status: 500 },
    );
  }
}
