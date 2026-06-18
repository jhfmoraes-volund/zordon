// DAL do "Design System do projeto" — um ContextSource singular (kind
// 'design_system') por projeto, anexado nas settings. O índice parcial
// `context_source_design_system_unique` garante 1 por projeto; aqui fazemos
// replace (delete o anterior + insere o novo) pra honrar essa cardinalidade.
//
// Diferença-chave vs kind 'document': o HTML é guardado CRU em `fullText`
// (o extrator stripa <style>/<script>, justo onde moram os tokens). PDF/DOCX
// caem no texto extraído. O arquivo bruto também vai pro bucket pra download.

import { db } from "@/lib/db";
import { extractTextFromBuffer } from "@/lib/design-session/file-extraction";

const BUCKET = "context-source-files";

export type DesignSystemDoc = {
  id: string;
  title: string;
  mimeType: string | null;
  size: number | null;
  updatedAt: string;
};

/** True quando o conteúdo deve ser guardado CRU (sem extração/stripping). */
function isRawText(filename: string, mimeType: string): boolean {
  const lower = filename.toLowerCase();
  return (
    mimeType === "text/html" ||
    mimeType.startsWith("text/") ||
    lower.endsWith(".html") ||
    lower.endsWith(".htm") ||
    lower.endsWith(".css") ||
    lower.endsWith(".md") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".json")
  );
}

/** Design system atual do projeto (ou null). Sem fullText — só metadados. */
export async function getProjectDesignSystem(
  projectId: string,
): Promise<DesignSystemDoc | null> {
  const supabase = db();
  const { data, error } = await supabase
    .from("ContextSource")
    .select("id, title, source, payload, capturedAt, updatedAt, createdAt")
    .eq("projectId", projectId)
    .eq("kind", "design_system")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const size = (data.payload as { size?: number } | null)?.size ?? null;
  return {
    id: data.id,
    title: data.title,
    mimeType: data.source,
    size,
    updatedAt: data.capturedAt ?? data.updatedAt ?? data.createdAt,
  };
}

/** URL assinada (1h) pra download do arquivo bruto, ou null. */
export async function getDesignSystemDownloadUrl(
  sourceId: string,
): Promise<string | null> {
  const supabase = db();
  const { data } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(sourceId, 3600);
  return data?.signedUrl ?? null;
}

/** Remove o design system do projeto (row + arquivo do bucket). Idempotente. */
export async function deleteProjectDesignSystem(
  projectId: string,
): Promise<void> {
  const supabase = db();
  const { data: existing, error } = await supabase
    .from("ContextSource")
    .select("id")
    .eq("projectId", projectId)
    .eq("kind", "design_system")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!existing) return;

  // Bucket primeiro (best-effort) — se a row sumir antes, a RLS de SELECT do
  // bucket (que resolve projectId via ContextSource) deixa o objeto órfão.
  await supabase.storage.from(BUCKET).remove([existing.id]);
  const { error: delError } = await supabase
    .from("ContextSource")
    .delete()
    .eq("id", existing.id);
  if (delError) throw new Error(delError.message);
}

/**
 * Substitui (ou cria) o design system do projeto. Delete-then-insert respeita
 * o índice UNIQUE parcial. Devolve os metadados do doc recém-anexado.
 */
export async function replaceProjectDesignSystem(args: {
  projectId: string;
  memberId: string;
  file: Buffer;
  filename: string;
  mimeType: string;
}): Promise<DesignSystemDoc> {
  const { projectId, memberId, file, filename, mimeType } = args;
  const supabase = db();

  // 1) Limpa o anterior (row + bucket).
  await deleteProjectDesignSystem(projectId);

  // 2) Conteúdo legível pro agente: HTML/texto cru; binário (PDF/DOCX) extraído.
  let fullText: string;
  if (isRawText(filename, mimeType)) {
    fullText = file.toString("utf-8");
  } else {
    const extraction = await extractTextFromBuffer(file, filename, mimeType);
    fullText = extraction.text;
  }

  const capturedAt = new Date().toISOString();

  // 3) Cria a row primeiro (a RLS do bucket resolve projectId via ela).
  const { data: source, error: sourceError } = await supabase
    .from("ContextSource")
    .insert({
      kind: "design_system",
      title: filename,
      projectId,
      createdBy: memberId,
      fullText: fullText || null,
      source: mimeType || null,
      capturedAt,
      payload: { size: file.length, filename },
    })
    .select("id")
    .single();
  if (sourceError || !source) {
    throw new Error(sourceError?.message ?? "Failed to create ContextSource");
  }

  // 4) Sobe o arquivo bruto no caminho = source.id (mesma convenção do pool).
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(source.id, file, {
      contentType: mimeType || "application/octet-stream",
      upsert: false,
    });
  if (uploadError) {
    await supabase.from("ContextSource").delete().eq("id", source.id);
    throw new Error(`Failed to upload file: ${uploadError.message}`);
  }

  return {
    id: source.id,
    title: filename,
    mimeType: mimeType || null,
    size: file.length,
    updatedAt: capturedAt,
  };
}
