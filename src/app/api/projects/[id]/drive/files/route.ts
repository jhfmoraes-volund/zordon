import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";

/**
 * GET /api/projects/[id]/drive/files
 *   Lê o índice ProjectDriveFile (espelho da pasta linkada) — nunca chama o
 *   Google aqui. Refresh é via POST /drive/sync. `importedFileIds` traz os
 *   externalId dos ContextSource kind='gdrive_file' do projeto (badge
 *   "no contexto" na aba, sem query no client).
 *   200 { files, syncedAt, folderId, importedFileIds }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const supabase = db();

  const [projectRes, filesRes, importedRes] = await Promise.all([
    supabase.from("Project").select("driveFolderId").eq("id", id).maybeSingle(),
    supabase
      .from("ProjectDriveFile")
      .select("*")
      .eq("projectId", id)
      .order("mimeType")
      .order("name"),
    supabase
      .from("ContextSource")
      .select("externalId")
      .eq("projectId", id)
      .eq("kind", "gdrive_file"),
  ]);

  if (projectRes.error) {
    return NextResponse.json({ error: projectRes.error.message }, { status: 500 });
  }
  if (!projectRes.data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (filesRes.error) {
    return NextResponse.json({ error: filesRes.error.message }, { status: 500 });
  }
  if (importedRes.error) {
    return NextResponse.json({ error: importedRes.error.message }, { status: 500 });
  }

  const files = filesRes.data ?? [];
  const syncedAt = files.reduce<string | null>(
    (max, f) => (max === null || f.syncedAt > max ? f.syncedAt : max),
    null
  );

  return NextResponse.json({
    files,
    syncedAt,
    folderId: projectRes.data.driveFolderId ?? null,
    importedFileIds: (importedRes.data ?? [])
      .map((s) => s.externalId)
      .filter(Boolean),
  });
}
