/**
 * GET /api/context-sources/[id]/content
 * Retorna o conteúdo completo (fullText) de um ContextSource.
 * Usa adapters para resolver conteúdo dinâmico (GSheets, GitHub).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as transcriptAdapter from "@/lib/context-sources/adapters/transcript";
import * as meetingAdapter from "@/lib/context-sources/adapters/meeting";
import * as csvAdapter from "@/lib/context-sources/adapters/csv";
import * as gsheetsAdapter from "@/lib/context-sources/adapters/gsheets";
import * as githubAdapter from "@/lib/context-sources/adapters/github";

export async function GET(
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

  try {
    // Dispatch to adapter based on kind
    let resolvedContent;
    switch (source.kind) {
      case "transcript":
        resolvedContent = await transcriptAdapter.resolveContent(supabase, source);
        break;
      case "meeting":
        resolvedContent = await meetingAdapter.resolveContent(supabase, source);
        break;
      case "spreadsheet_csv":
        resolvedContent = await csvAdapter.resolveContent(supabase, source);
        break;
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

    return NextResponse.json({
      id: source.id,
      kind: source.kind,
      title: source.title,
      externalUrl: source.externalUrl,
      capturedAt: source.capturedAt,
      summary: source.summary,
      fullText: resolvedContent.fullText,
      snapshotAt: resolvedContent.snapshotAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to resolve content";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
