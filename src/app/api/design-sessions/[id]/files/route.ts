import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;

  const { data, error } = await db()
    .from("DesignSessionFile")
    .select("id, sessionId, name, size, mimeType, extractionStatus, uploadedByMemberId, createdAt")
    .eq("sessionId", id)
    .order("createdAt", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ files: data ?? [] });
}
