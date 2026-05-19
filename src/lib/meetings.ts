import "server-only";

import {
  RoamClient,
  cuesToText,
  type RoamTranscriptListItem,
  type RoamTranscriptDetail,
} from "./roam";
import {
  GranolaClient,
  getGranolaClient,
  transcriptToText,
  type GranolaNoteListItem,
  type GranolaNoteDetail,
} from "./granola";

/**
 * Unified meetings layer.
 *
 * Volund integrates with two meeting-intelligence providers:
 *   - Roam HQ  (per-PM API token, stored encrypted in MemberIntegration)
 *   - Granola  (workspace-wide API key, env GRANOLA_KEY)
 *
 * This module exposes a single API over both. Each function takes an
 * explicit `source` (or `sources` for fan-out) so callers stay in control
 * of which provider is queried — no magic fallbacks, no hidden ordering.
 *
 * Returned items are normalized into `Meeting` / `MeetingDetail`, which
 * are intentionally a strict subset of what each provider returns. When
 * a caller needs provider-specific data, the `raw` field carries the
 * original payload (typed via discriminated union on `source`).
 */

// ─── Public types ─────────────────────────────────────────

export type MeetingSource = "roam" | "granola";

export interface MeetingParticipant {
  name: string;
  email?: string;
}

export interface Meeting {
  source: MeetingSource;
  id: string;
  title: string;
  start: string; // ISO 8601
  end?: string;
  participants: MeetingParticipant[];
  summary?: string;
}

export interface MeetingTranscriptLine {
  speaker: string;
  text: string;
  /** Seconds from the start of the meeting; undefined when the provider doesn't expose timestamps. */
  startOffset?: number;
}

export interface MeetingDetail extends Meeting {
  durationMinutes?: number;
  transcript: MeetingTranscriptLine[];
  /** Pre-rendered transcript text in `[HH:MM] Speaker: text` format. */
  transcriptText: string;
  actionItems: { title: string; description?: string }[];
  raw:
    | { source: "roam"; data: RoamTranscriptDetail }
    | { source: "granola"; data: GranolaNoteDetail };
}

export interface ListMeetingsOptions {
  since?: string; // ISO date
  until?: string;
  max?: number;
  /** Case-insensitive partial match against participant names. */
  participant?: string;
}

/**
 * Per-source connectivity hints — surfaced so the UI / agent can show
 * the right "not connected" CTA instead of a generic error.
 */
export interface SourceAvailability {
  roam: { available: boolean; reason?: "no_token" };
  granola: { available: boolean; reason?: "no_env_key" };
}

// ─── Resolver ─────────────────────────────────────────────

export interface MeetingsResolver {
  /** Roam token for the current member (null when not connected). */
  roamToken?: string | null;
}

/**
 * Internal: returns the right SDK client for a source, or null when the
 * caller hasn't supplied the credential.
 */
function clientFor(
  source: MeetingSource,
  resolver: MeetingsResolver,
): RoamClient | GranolaClient | null {
  if (source === "roam") {
    return resolver.roamToken ? new RoamClient(resolver.roamToken) : null;
  }
  return getGranolaClient();
}

export function getSourceAvailability(resolver: MeetingsResolver): SourceAvailability {
  return {
    roam: resolver.roamToken
      ? { available: true }
      : { available: false, reason: "no_token" },
    granola: process.env.GRANOLA_KEY?.trim()
      ? { available: true }
      : { available: false, reason: "no_env_key" },
  };
}

// ─── Normalizers ──────────────────────────────────────────

function normalizeRoamItem(t: RoamTranscriptListItem): Meeting {
  return {
    source: "roam",
    id: t.id,
    title: t.eventName || "Sem título",
    start: t.start,
    end: t.end,
    participants: t.participants.map((p) => ({ name: p.name, email: p.email })),
  };
}

function normalizeGranolaItem(n: GranolaNoteListItem): Meeting {
  return {
    source: "granola",
    id: n.id,
    title: n.title || "Sem título",
    start: n.created_at,
    // The list endpoint does not return participants. Fetch the detail to populate.
    participants: [],
  };
}

function normalizeRoamDetail(d: RoamTranscriptDetail): MeetingDetail {
  const durationMinutes = Math.round(
    (new Date(d.end).getTime() - new Date(d.start).getTime()) / 60000,
  );
  return {
    source: "roam",
    id: d.id,
    title: d.eventName || "Sem título",
    start: d.start,
    end: d.end,
    participants: d.participants.map((p) => ({ name: p.name, email: p.email })),
    summary: d.summary,
    durationMinutes,
    transcript: d.cues.map((c) => ({
      speaker: c.speaker,
      text: c.text,
      startOffset: c.startOffset,
    })),
    transcriptText: cuesToText(d.cues),
    actionItems: d.actionItems.map((a) => ({ title: a.title, description: a.description })),
    raw: { source: "roam", data: d },
  };
}

function normalizeGranolaDetail(d: GranolaNoteDetail): MeetingDetail {
  const lines = d.transcript ?? [];
  const start = d.calendar_event?.scheduled_start_time ?? d.created_at;
  const end = d.calendar_event?.scheduled_end_time;
  const durationMinutes = end
    ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
    : undefined;
  const recordingStart = lines[0]?.start_time ? new Date(lines[0].start_time).getTime() : null;

  // Attendees is the richest source (name + email); fall back to invitees (email-only).
  const participants: MeetingParticipant[] =
    d.attendees?.map((a) => ({ name: a.name ?? a.email ?? "", email: a.email })) ??
    d.calendar_event?.invitees?.map((i) => ({ name: i.name ?? i.email, email: i.email })) ??
    [];

  return {
    source: "granola",
    id: d.id,
    title: d.title || d.calendar_event?.event_title || "Sem título",
    start,
    end,
    participants,
    summary: d.summary_text,
    durationMinutes,
    transcript: lines.map((l) => ({
      speaker:
        l.speaker?.name ??
        (l.speaker?.source === "microphone" ? "Host" : "Guest"),
      text: l.text,
      startOffset:
        l.start_time && recordingStart != null
          ? Math.max(0, (new Date(l.start_time).getTime() - recordingStart) / 1000)
          : undefined,
    })),
    transcriptText: transcriptToText(lines),
    actionItems: [],
    raw: { source: "granola", data: d },
  };
}

// ─── Public API ───────────────────────────────────────────

/**
 * List recent meetings from one or more sources, merged and sorted DESC
 * by start time. Sources missing credentials are silently skipped — call
 * `getSourceAvailability()` first if you need to surface "not connected".
 *
 * Per-source errors are caught and returned in `errors` so a single
 * failing provider doesn't take down the whole list.
 */
export async function listMeetings(
  resolver: MeetingsResolver,
  opts: ListMeetingsOptions & { sources?: MeetingSource[] } = {},
): Promise<{
  meetings: Meeting[];
  errors: Partial<Record<MeetingSource, string>>;
  availability: SourceAvailability;
}> {
  const sources = opts.sources ?? (["roam", "granola"] satisfies MeetingSource[]);
  const needle = opts.participant?.toLowerCase();
  const participantFilter = needle
    ? (names: string[]) => names.some((n) => n.toLowerCase().includes(needle))
    : undefined;

  const errors: Partial<Record<MeetingSource, string>> = {};

  const results = await Promise.all(
    sources.map(async (source): Promise<Meeting[]> => {
      const client = clientFor(source, resolver);
      if (!client) return [];

      try {
        if (source === "roam") {
          const items = await (client as RoamClient).listTranscriptsInRange({
            since: opts.since,
            until: opts.until,
            max: opts.max,
            participantFilter,
          });
          return items.map(normalizeRoamItem);
        }
        // Granola's list endpoint omits participants, so participantFilter
        // is intentionally not forwarded — applying it would drop everything.
        const items = await (client as GranolaClient).listNotesInRange({
          since: opts.since,
          until: opts.until,
          max: opts.max,
        });
        return items.map(normalizeGranolaItem);
      } catch (err) {
        errors[source] = (err as Error).message;
        return [];
      }
    }),
  );

  const meetings = results.flat().sort((a, b) => b.start.localeCompare(a.start));
  return { meetings, errors, availability: getSourceAvailability(resolver) };
}

/**
 * Fetch the full detail of a single meeting from the named source.
 * Throws when the source has no credentials configured — unlike `listMeetings`,
 * a missing client is a programming error at this point (the caller already
 * picked the source from a list response).
 */
export async function getMeetingDetail(
  resolver: MeetingsResolver,
  source: MeetingSource,
  meetingId: string,
): Promise<MeetingDetail> {
  const client = clientFor(source, resolver);
  if (!client) {
    throw new Error(
      source === "roam"
        ? "Roam não conectado para este usuário."
        : "Granola não configurado (GRANOLA_KEY ausente).",
    );
  }

  if (source === "roam") {
    const detail = await (client as RoamClient).getTranscript(meetingId);
    return normalizeRoamDetail(detail);
  }
  const detail = await (client as GranolaClient).getNote(meetingId, {
    includeTranscript: true,
  });
  return normalizeGranolaDetail(detail);
}

/**
 * Ask an AI question about a specific meeting. Only Roam exposes this
 * natively; for Granola we surface a clear "unsupported" error so the
 * caller can fall back to client-side RAG over the transcript.
 */
export async function askMeeting(
  resolver: MeetingsResolver,
  source: MeetingSource,
  meetingId: string,
  question: string,
): Promise<{ answer: string }> {
  if (source !== "roam") {
    throw new Error("ask_meeting é suportado apenas para fontes Roam no momento.");
  }
  const client = clientFor("roam", resolver) as RoamClient | null;
  if (!client) throw new Error("Roam não conectado para este usuário.");
  return client.promptTranscript(meetingId, question);
}
