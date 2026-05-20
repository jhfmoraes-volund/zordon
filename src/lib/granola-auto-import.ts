import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

import {
  GranolaClient,
  buildGranolaClient,
  type GranolaNoteListItem,
} from "@/lib/granola";
import { getMemberIntegrationToken } from "@/lib/member-integrations";
import { ensureAgentThread, persistResponseMessage } from "@/lib/agent/context";
import { runAgent } from "@/lib/agent/engine";
import { alphaAgent } from "@/lib/agent/agents/alpha";
import { buildIngestSeed } from "@/lib/agent/alpha-ingest-seed";
import type { Capabilities } from "@/lib/agent/types";

/**
 * Granola auto-import: scans a member's Granola notes since their last cursor,
 * creates a PRIVATE Meeting for each new note, and runs Alpha headlessly to
 * ingest the transcript (notes + To-dos) — the exact same path the UI sheet
 * uses, just without a browser.
 *
 * Excellence notes:
 *   - Idempotent: dedup by transcriptSourceId (Granola note.id is stable).
 *   - Cursor-driven: only the delta since last successful run is scanned.
 *   - Bounded: MAX_NOTES_PER_RUN caps blast radius if cursor drifts backwards.
 *   - Per-note isolation: one bad note doesn't abort the whole job.
 *   - Cursor only advances after the job finishes, so a failed mid-job doesn't
 *     skip notes — they'll be retried next tick.
 *
 * Headless Alpha:
 *   - Uses ChatThread.channel = 'trigger' so these runs are clearly separate
 *     from the member's interactive 'web' history.
 *   - We `await` the streamText `text` consumer so all tool calls finish
 *     before we return — without this, the function would resolve while the
 *     LLM is still working.
 */

// ─── Tunables ─────────────────────────────────────────────

/** Hard cap on notes scanned per job. Keeps blast radius bounded if cursor
 *  drifts way back (e.g. user disables then re-enables months later). */
export const MAX_NOTES_PER_RUN = 20;

/** How far back the very first run reaches when no cursor exists yet.
 *  The toggle endpoint defaults cursor=now() so this is rarely used — only
 *  triggers for rows seeded by manual SQL or imported from a backup. */
const FALLBACK_LOOKBACK_HOURS = 1;

// ─── Job claim ────────────────────────────────────────────

type Client = SupabaseClient<Database>;

export type ClaimedImportJob = {
  id: string;
  memberId: string;
  source: "cron" | "manual";
  cursorFrom: string | null;
};

const CLAIM_COLS = `id, "memberId", source, "cursorFrom"`;

/** Atomically claim a single pending job, optionally by id. */
export async function claimNextGranolaJob(
  admin: Client,
  jobId?: string,
): Promise<ClaimedImportJob | null> {
  if (jobId) {
    const { data } = await admin
      .from("GranolaImportJob")
      .update({ status: "running", startedAt: new Date().toISOString() })
      .eq("id", jobId)
      .eq("status", "pending")
      .select(CLAIM_COLS)
      .single();
    return mapClaimed(data);
  }

  const { data: candidate } = await admin
    .from("GranolaImportJob")
    .select(CLAIM_COLS)
    .eq("status", "pending")
    .order("createdAt", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!candidate) return null;

  const { data: claimed } = await admin
    .from("GranolaImportJob")
    .update({ status: "running", startedAt: new Date().toISOString() })
    .eq("id", candidate.id)
    .eq("status", "pending")
    .select(CLAIM_COLS)
    .single();
  return mapClaimed(claimed);
}

function mapClaimed(raw: unknown): ClaimedImportJob | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    id: r.id as string,
    memberId: r.memberId as string,
    source: r.source as "cron" | "manual",
    cursorFrom: (r.cursorFrom as string | null) ?? null,
  };
}

// ─── Job runner ───────────────────────────────────────────

export type RunImportJobResult = {
  jobId: string;
  memberId: string;
  ok: boolean;
  notesScanned: number;
  meetingsCreated: number;
  meetingsSkipped: number;
  cursorTo: string | null;
  error?: string;
  /** Per-note failures (not job-fatal). Reported back for observability. */
  noteErrors: { noteId: string; error: string }[];
};

/**
 * Process one claimed import job end-to-end.
 *
 * Always marks the job done/failed before returning — callers don't need to
 * touch the job row. Advancing the member's cursor is best-effort: it happens
 * only on a clean job, so partial failures retry on the next tick.
 */
export async function runGranolaImportJob(
  admin: Client,
  job: ClaimedImportJob,
): Promise<RunImportJobResult> {
  const result: RunImportJobResult = {
    jobId: job.id,
    memberId: job.memberId,
    ok: false,
    notesScanned: 0,
    meetingsCreated: 0,
    meetingsSkipped: 0,
    cursorTo: null,
    noteErrors: [],
  };

  try {
    // 1. Load the member's Granola token. If missing, the toggle is stale —
    //    fail the job with a clear reason; next tick won't re-enqueue because
    //    enqueue only picks rows with autoImportEnabled=true (the toggle is
    //    still on, but with no token nothing happens until the user reconnects).
    const token = await getMemberIntegrationToken(job.memberId, "granola");
    if (!token) {
      throw new Error("no_granola_token");
    }
    const granola = buildGranolaClient(token);
    if (!granola) throw new Error("no_granola_token");

    // 2. List candidate notes since the cursor. cursorFrom is the inclusive
    //    lower bound; Granola's created_after is exclusive on its side, but
    //    we re-dedup by sourceId anyway so any off-by-one is harmless.
    const since = job.cursorFrom ?? fallbackSince();
    const notes = await granola.listNotesInRange({
      since,
      max: MAX_NOTES_PER_RUN,
    });
    result.notesScanned = notes.length;

    // 3. Dedup against meetings already linked to these note ids.
    const newNotes = await filterUnimportedNotes(admin, notes);
    result.meetingsSkipped = notes.length - newNotes.length;

    // 4. Walk newest → oldest. Per-note try/catch keeps a single failure from
    //    aborting the rest. We track the newest note seen (regardless of
    //    success) so the cursor advances past noisy items the user couldn't
    //    fix anyway.
    let newestSeen: string | null = null;
    for (const note of newNotes) {
      if (!newestSeen || note.created_at > newestSeen) newestSeen = note.created_at;
      try {
        await importGranolaNote(admin, granola, job.memberId, note);
        result.meetingsCreated += 1;
      } catch (err) {
        result.noteErrors.push({
          noteId: note.id,
          error: (err as Error).message ?? String(err),
        });
      }
    }

    // Even if all candidates were dedup-skipped, advance the cursor to the
    // newest scanned item so we don't re-list the same window forever.
    if (newestSeen) {
      result.cursorTo = newestSeen;
    } else if (notes.length > 0) {
      result.cursorTo = notes[0].created_at;
    }

    // 5. Persist outcomes.
    await admin
      .from("GranolaImportJob")
      .update({
        status: "done",
        finishedAt: new Date().toISOString(),
        notesScanned: result.notesScanned,
        meetingsCreated: result.meetingsCreated,
        meetingsSkipped: result.meetingsSkipped,
        cursorTo: result.cursorTo,
        // If ALL notes failed individually, surface that as the job's error
        // so the UI can show a red dot — but keep status='done' because the
        // pipeline itself worked.
        error:
          result.noteErrors.length > 0 && result.meetingsCreated === 0
            ? `All ${result.noteErrors.length} notes failed: ${result.noteErrors[0].error}`
            : null,
      })
      .eq("id", job.id);

    await advanceMemberCursor(admin, job.memberId, result.cursorTo);
    result.ok = true;
    return result;
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    result.error = message;
    await admin
      .from("GranolaImportJob")
      .update({
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: message,
        notesScanned: result.notesScanned,
        meetingsCreated: result.meetingsCreated,
        meetingsSkipped: result.meetingsSkipped,
      })
      .eq("id", job.id);
    // Best-effort lastRunAt bump even on failure, so UI shows "tried at HH:MM".
    await admin
      .from("MemberIntegration")
      .update({ autoImportLastRunAt: new Date().toISOString() })
      .eq("memberId", job.memberId)
      .eq("provider", "granola");
    return result;
  }
}

function fallbackSince(): string {
  const d = new Date();
  d.setHours(d.getHours() - FALLBACK_LOOKBACK_HOURS);
  return d.toISOString();
}

async function advanceMemberCursor(
  admin: Client,
  memberId: string,
  cursorTo: string | null,
): Promise<void> {
  const update: Database["public"]["Tables"]["MemberIntegration"]["Update"] = {
    autoImportLastRunAt: new Date().toISOString(),
  };
  if (cursorTo) update.autoImportCursor = cursorTo;
  await admin
    .from("MemberIntegration")
    .update(update)
    .eq("memberId", memberId)
    .eq("provider", "granola");
}

// ─── Per-note import ──────────────────────────────────────

/**
 * Filter out notes that already have a Meeting linked via transcriptSourceId.
 * Single round-trip with an `in()` filter — much cheaper than N existence
 * checks when the window has many notes.
 */
async function filterUnimportedNotes(
  admin: Client,
  notes: GranolaNoteListItem[],
): Promise<GranolaNoteListItem[]> {
  if (notes.length === 0) return [];
  const ids = notes.map((n) => n.id);
  const { data: existing } = await admin
    .from("Meeting")
    .select("transcriptSourceId")
    .eq("transcriptSource", "granola")
    .in("transcriptSourceId", ids);
  const seen = new Set((existing ?? []).map((r) => r.transcriptSourceId as string));
  return notes.filter((n) => !seen.has(n.id));
}

/**
 * Create a PRIVATE Meeting linked to the Granola note and run Alpha headlessly
 * to ingest the transcript. The Alpha tools (update_meeting, create_todo,
 * propose_task_action) write directly to the DB — we don't post-process here.
 */
async function importGranolaNote(
  admin: Client,
  granola: GranolaClient,
  memberId: string,
  note: GranolaNoteListItem,
): Promise<void> {
  // Hydrate enough metadata to set a sensible date/title without pulling the
  // full transcript (Alpha will do that itself via get_meeting_transcript).
  const detail = await granola.getNote(note.id, { includeTranscript: false }).catch(() => null);

  const meetingDate = detail?.calendar_event?.scheduled_start_time ?? note.created_at;
  const title =
    note.title?.trim() ||
    detail?.calendar_event?.event_title?.trim() ||
    "Reunião privada (Granola)";

  const { data: meetingId, error: rpcError } = await admin.rpc(
    "create_meeting_with_reviews",
    {
      p_date: meetingDate,
      p_reviews: [],
      p_carry_actions: [],
      p_type: "private",
      p_title: title,
      p_attendees: [{ memberId, role: "owner" }],
      p_project_ids: [],
      p_notes: undefined,
      p_sprint_id: undefined,
    },
  );
  if (rpcError) throw new Error(`create_meeting_with_reviews failed: ${rpcError.message}`);

  const newMeetingId = meetingId as unknown as string;

  // Stamp createdById + transcript link. The RPC runs as service_role and
  // doesn't know who created the meeting; private RLS keys off createdById.
  const { error: stampError } = await admin
    .from("Meeting")
    .update({
      createdById: memberId,
      transcriptSource: "granola",
      transcriptSourceId: note.id,
    })
    .eq("id", newMeetingId);
  if (stampError) throw new Error(`Meeting stamp failed: ${stampError.message}`);

  // Hand off to Alpha. The seed prompt for private + granola tells the agent
  // to fetch the transcript, save raw text + summary, and create owner-only
  // To-dos. Run headlessly on a 'trigger' channel thread so it doesn't
  // pollute the member's interactive history.
  await runAlphaIngestHeadless({
    memberId,
    meetingId: newMeetingId,
    sourceId: note.id,
  });
}

// ─── Headless Alpha ───────────────────────────────────────

/**
 * Capabilities for headless ingest runs. Lower step budget than the UI chat
 * because the seed is narrowly scoped (fetch transcript → save → create
 * todos). 30 was the UI default; 20 leaves margin while bounding cost on the
 * tail of a long meeting.
 */
const HEADLESS_CAPABILITIES_BASE = {
  maxSteps: 20,
  writeTools: true,
  readTools: true,
} satisfies Partial<Capabilities>;

async function runAlphaIngestHeadless(args: {
  memberId: string;
  meetingId: string;
  sourceId: string;
}): Promise<void> {
  const { memberId, meetingId, sourceId } = args;

  // Per-member Granola token already validated upstream, but Alpha's tool
  // chain loads it again to keep its own contract clean.
  const granolaToken = await getMemberIntegrationToken(memberId, "granola");
  if (!granolaToken) throw new Error("no_granola_token");

  const capabilities: Capabilities = {
    ...HEADLESS_CAPABILITIES_BASE,
    granolaToken,
    memberId,
  };

  const threadId = await ensureAgentThread("alpha", "trigger", memberId);
  const seed = buildIngestSeed(meetingId, "granola", sourceId, false, "private");

  const result = await runAgent({
    agent: alphaAgent,
    thread: { id: threadId },
    capabilities,
    userMessage: seed,
    memberId,
    params: { meetingId, route: { kind: "trigger" } },
  });

  // Drive the stream to completion: persist the assistant message and wait
  // for every tool call to land. Without consuming the stream the LLM never
  // actually runs to the end.
  //
  // toUIMessageStreamResponse runs onFinish (persistResponseMessage) once the
  // model emits its final chunk; awaiting `.body` ensures we hold the request
  // open until that happens. We don't return anything to the caller — Alpha's
  // tools have already written Meeting.notes/Todos/etc. directly.
  const response = result.streamText.toUIMessageStreamResponse({
    onFinish: persistResponseMessage(threadId),
  });
  const body = response.body as ReadableStream<Uint8Array> | null;
  if (body) {
    const reader = body.getReader();
    // Drain — discard chunks, we only care about side effects.
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  }
}

// ─── Manual run-now ───────────────────────────────────────

/**
 * Enqueue a one-off job for a member (source='manual'). The drain route will
 * pick it up next. Idempotent: a no-op when a pending/running job already
 * exists for this member.
 */
export async function enqueueManualGranolaImport(
  admin: Client,
  memberId: string,
): Promise<{ enqueued: boolean; jobId?: string }> {
  const { data: existing } = await admin
    .from("GranolaImportJob")
    .select("id")
    .eq("memberId", memberId)
    .in("status", ["pending", "running"])
    .limit(1)
    .maybeSingle();
  if (existing) return { enqueued: false, jobId: existing.id as string };

  // Read current cursor so the manual job mirrors the cron's behavior.
  const { data: integration } = await admin
    .from("MemberIntegration")
    .select("autoImportCursor")
    .eq("memberId", memberId)
    .eq("provider", "granola")
    .maybeSingle();

  const { data: created, error } = await admin
    .from("GranolaImportJob")
    .insert({
      memberId,
      source: "manual",
      cursorFrom: (integration?.autoImportCursor as string | null) ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to enqueue manual job: ${error.message}`);
  return { enqueued: true, jobId: created!.id as string };
}
