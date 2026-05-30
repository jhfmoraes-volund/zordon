/**
 * POST /api/context-sources/[id]/refresh
 * Re-fetch content para GSheets e GitHub (snapshot atualizado).
 * CSV é imutável após upload.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as gsheetsAdapter from "@/lib/context-sources/adapters/gsheets";
import * as githubAdapter from "@/lib/context-sources/adapters/github";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = db();

  // Fetch ContextSource metadata
  const { data: source, error } = await supabase
    .from("ContextSource")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !source) {
    return NextResponse.json({ error: "ContextSource not found" }, { status: 404 });
  }

  // Only GSheets and GitHub support refresh
  if (
    source.kind === "transcript" ||
    source.kind === "meeting" ||
    source.kind === "spreadsheet_csv"
  ) {
    return NextResponse.json(
      { error: `ContextSource kind '${source.kind}' does not support refresh (snapshot only)` },
      { status: 400 },
    );
  }

  try {
    let resolvedContent;
    switch (source.kind) {
      case "spreadsheet_gsheets":
        resolvedContent = await gsheetsAdapter.resolveContent(supabase, source);
        break;
      case "github_repo":
      case "github_pr":
      case "github_issue":
        resolvedContent = await githubAdapter.resolveContent(supabase, source);
        break;
      default:
        return NextResponse.json(
          { error: `Unsupported ContextSource kind: ${source.kind}` },
          { status: 400 },
        );
    }

    // Update fullText in database
    const { error: updateError } = await supabase
      .from("ContextSource")
      .update({
        fullText: resolvedContent.fullText,
        updatedAt: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) {
      throw new Error(`Failed to update ContextSource: ${updateError.message}`);
    }

    return NextResponse.json({
      ok: true,
      id: source.id,
      snapshotAt: resolvedContent.snapshotAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to refresh content";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
