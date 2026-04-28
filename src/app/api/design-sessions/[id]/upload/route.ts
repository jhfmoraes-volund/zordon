import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";
import { db } from "@/lib/db";
import type { Json } from "@/lib/supabase/database.types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const denied = await requireSessionAccessApi(sessionId);
  if (denied) return denied;

  const formData = await req.formData();
  const files = formData.getAll("files") as File[];

  if (!files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const extracted: Array<{
    id: string;
    name: string;
    size: number;
    type: string;
    extractedText: string;
  }> = [];

  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    let text = "";

    if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse");
      const result = await pdfParse(buffer);
      text = result.text;
    } else if (
      file.type ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.name.endsWith(".docx")
    ) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if (
      file.type === "text/html" ||
      file.name.endsWith(".html") ||
      file.name.endsWith(".htm")
    ) {
      const { parse } = await import("node-html-parser");
      const root = parse(buffer.toString("utf-8"));
      root.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
      text = root.text.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    } else {
      // TXT, MD, etc
      text = buffer.toString("utf-8");
    }

    extracted.push({
      id: crypto.randomUUID().slice(0, 7),
      name: file.name,
      size: file.size,
      type: file.type || "text/plain",
      extractedText: text,
    });
  }

  // Save extracted files to pre_work step data
  const { data: existing } = await db()
    .from("DesignSessionStepData")
    .select("data")
    .eq("sessionId", sessionId)
    .eq("stepKey", "pre_work")
    .maybeSingle();

  const currentData = (existing?.data as Record<string, unknown>) || {};
  const currentFiles = (currentData.files as typeof extracted) || [];

  await db()
    .from("DesignSessionStepData")
    .upsert(
      {
        id: crypto.randomUUID(),
        sessionId,
        stepKey: "pre_work",
        stepIndex: 0,
        data: { ...currentData, files: [...currentFiles, ...extracted] } as unknown as Json,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: "sessionId,stepKey" }
    );

  return NextResponse.json({ files: extracted });
}
