import { NextResponse } from "next/server";

/**
 * @deprecated Task generation is now handled by the Vitor agent via the
 * create_task tool in the chat API. This endpoint is kept as a stub to
 * avoid 404s from any remaining client references.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Task generation has moved to the agent chat. Use the Briefing step chat instead." },
    { status: 410 }
  );
}
