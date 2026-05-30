import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type ContextSource = Database["public"]["Tables"]["ContextSource"]["Row"];

export interface ResolvedContent {
  fullText: string;
  snapshotAt: string;
}

export async function resolveContent(
  supabase: SupabaseClient<Database>,
  source: ContextSource
): Promise<ResolvedContent> {
  // For meetings, externalId points to the Meeting row
  if (!source.externalId) {
    throw new Error(`Meeting context source ${source.id} missing externalId`);
  }

  const { data: meeting, error } = await supabase
    .from("Meeting")
    .select("*")
    .eq("id", source.externalId)
    .single();

  if (error || !meeting) {
    throw new Error(
      `Failed to fetch Meeting ${source.externalId}: ${error?.message || "not found"}`
    );
  }

  // Build fullText from meeting data
  const fullText = [
    `# ${meeting.title || "Meeting"}`,
    "",
    `**Date:** ${meeting.date}`,
    `**Type:** ${meeting.type}`,
    meeting.kind ? `**Kind:** ${meeting.kind}` : null,
    "",
    meeting.notes || "(No notes)",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    fullText,
    snapshotAt: meeting.date || source.createdAt,
  };
}
