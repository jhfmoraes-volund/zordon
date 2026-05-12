import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionEditApi } from "@/lib/dal";

const BUCKET = "design-session-files";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const supabase = db();

  const { data: row } = await supabase
    .from("DesignSessionFile")
    .select("storagePath")
    .eq("id", fileId)
    .eq("sessionId", id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const { error: rmErr } = await supabase.storage
    .from(BUCKET)
    .remove([row.storagePath]);
  if (rmErr) {
    // Storage removal failure shouldn't block the row delete — file metadata
    // going away matters more than a possible orphan in the bucket.
    console.error("[files DELETE] storage cleanup failed:", rmErr.message);
  }

  const { error: dbErr } = await supabase
    .from("DesignSessionFile")
    .delete()
    .eq("id", fileId)
    .eq("sessionId", id);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
