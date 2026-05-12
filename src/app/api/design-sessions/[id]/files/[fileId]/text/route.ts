import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;

  const { data, error } = await db()
    .from("DesignSessionFile")
    .select("name, extractedText, extractionStatus")
    .eq("id", fileId)
    .eq("sessionId", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "File not found" }, { status: 404 });

  return NextResponse.json({
    name: data.name,
    extractedText: data.extractedText,
    extractionStatus: data.extractionStatus,
  });
}
