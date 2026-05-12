import { NextRequest, NextResponse } from "next/server";
import { requireSessionEditApi } from "@/lib/dal";
import { db } from "@/lib/db";
import {
  extractTextFromBuffer,
  isOverSizeLimit,
} from "@/lib/design-session/file-extraction";

const BUCKET = "design-session-files";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionEditApi(sessionId);
  if (denied) return denied;

  const formData = await req.formData();
  const files = formData.getAll("files") as File[];

  if (!files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  for (const file of files) {
    if (isOverSizeLimit(file.size)) {
      return NextResponse.json(
        { error: `File "${file.name}" exceeds 25MB limit` },
        { status: 413 },
      );
    }
  }

  const supabase = db();
  const inserted: Array<{
    id: string;
    name: string;
    size: number;
    mimeType: string;
    storagePath: string;
    extractionStatus: string;
  }> = [];

  for (const file of files) {
    const fileId = crypto.randomUUID();
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "application/octet-stream";

    const extraction = await extractTextFromBuffer(buffer, file.name, mimeType);

    const storagePath = `${sessionId}/${fileId}/${sanitizeFilename(file.name)}`;
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });
    if (uploadErr) {
      return NextResponse.json(
        { error: `Storage upload failed for "${file.name}": ${uploadErr.message}` },
        { status: 500 },
      );
    }

    const { data, error: dbErr } = await supabase
      .from("DesignSessionFile")
      .insert({
        id: fileId,
        sessionId,
        name: file.name,
        size: file.size,
        mimeType,
        storagePath,
        extractedText: extraction.text || null,
        extractionStatus: extraction.status,
      })
      .select()
      .single();
    if (dbErr) {
      // Best-effort cleanup of the storage object on row insert failure.
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json(
        { error: `DB insert failed for "${file.name}": ${dbErr.message}` },
        { status: 500 },
      );
    }

    inserted.push({
      id: data.id,
      name: data.name,
      size: data.size,
      mimeType: data.mimeType,
      storagePath: data.storagePath,
      extractionStatus: data.extractionStatus,
    });
  }

  return NextResponse.json({ files: inserted });
}

function sanitizeFilename(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 200);
}
