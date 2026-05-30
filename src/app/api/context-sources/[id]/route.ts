/**
 * GET /api/context-sources/[id]
 * Retorna metadata de um ContextSource (sem fullText — use /content pra isso).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = db();

  const { data: source, error } = await supabase
    .from("ContextSource")
    .select("id, kind, title, externalUrl, capturedAt, summary, projectId, createdAt, createdBy")
    .eq("id", id)
    .single();

  if (error || !source) {
    return NextResponse.json({ error: "ContextSource not found" }, { status: 404 });
  }

  // RLS handles access control
  return NextResponse.json(source);
}
