import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi } from "@/lib/dal";

const BUCKET = "design-session-files";
const SIGNED_URL_TTL_SECONDS = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;

  const supabase = db();
  const { data: row } = await supabase
    .from("DesignSessionFile")
    .select("name, storagePath")
    .eq("id", fileId)
    .eq("sessionId", id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.storagePath, SIGNED_URL_TTL_SECONDS, {
      download: row.name,
    });
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to sign URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: data.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS });
}
