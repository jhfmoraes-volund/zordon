import "server-only";

// ─── Types (from Granola public API v1) ───────────────────

export interface GranolaParticipant {
  name?: string;
  email?: string;
}

export interface GranolaCalendarEvent {
  event_title?: string;
  calendar_event_id?: string;
  organiser?: string;
  scheduled_start_time?: string; // ISO 8601 (with TZ offset)
  scheduled_end_time?: string;
  invitees?: { email: string; name?: string }[];
}

export interface GranolaNoteListItem {
  id: string;
  object?: "note";
  title: string | null;
  owner?: { name?: string; email?: string };
  /** ISO 8601 — when the note was created (recording started). */
  created_at: string;
  updated_at?: string;
}

export interface GranolaTranscriptLine {
  text: string;
  start_time?: string; // ISO 8601
  end_time?: string;
  speaker?: { source?: "microphone" | "speaker"; name?: string };
}

/**
 * A folder a note belongs to. Granola's v1.1.0 `folder_membership` returns the
 * direct container plus ancestor folders, so a note can list several entries.
 */
export interface GranolaFolderMembership {
  folder_id: string;
}

export interface GranolaNoteDetail extends GranolaNoteListItem {
  web_url?: string;
  calendar_event?: GranolaCalendarEvent;
  /** Resolved meeting attendees with names — preferred over calendar_event.invitees. */
  attendees?: GranolaParticipant[];
  folder_membership?: GranolaFolderMembership[];
  transcript?: GranolaTranscriptLine[];
  summary_text?: string;
  summary_markdown?: string;
}

/**
 * A folder in the Granola workspace. Hierarchy is expressed via
 * `parent_folder_id` (null for top-level folders). Available since API v1.1.0.
 */
export interface GranolaFolder {
  id: string;
  object?: "folder";
  name: string | null;
  parent_folder_id?: string | null;
}

// ─── Client ───────────────────────────────────────────────

/**
 * Granola public API client — v1.
 * Base URL: https://public-api.granola.ai/v1
 *
 * Authentication is workspace-scoped via a single API key (env GRANOLA_KEY).
 * Unlike Roam (per-PM tokens), Granola exposes only one credential per
 * workspace, so this client is a singleton consumed via getGranolaClient().
 *
 * Endpoints used:
 *   GET /notes                                — list notes (paginated)
 *   GET /notes?folder_id={id}                 — list notes within a folder (v1.1.0)
 *   GET /notes/{id}?include=transcript        — full note detail
 *   GET /folders                              — list folders (v1.1.0)
 */
export class GranolaClient {
  private baseUrl = "https://public-api.granola.ai/v1";
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("Granola API key is required");
    this.apiKey = apiKey;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Granola API ${res.status}: ${body || res.statusText}`);
    }

    return res.json() as Promise<T>;
  }

  /**
   * List notes (paginated). Granola only returns notes that already have
   * an AI-generated summary + transcript — drafts are silently filtered out.
   */
  async listNotes(opts?: {
    cursor?: string;
    limit?: number;
    createdAfter?: string; // ISO 8601
    folderId?: string; // restrict to a single folder (v1.1.0)
  }): Promise<{ notes: GranolaNoteListItem[]; hasMore: boolean; cursor: string | null }> {
    const params = new URLSearchParams();
    if (opts?.cursor) params.set("cursor", opts.cursor);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.createdAfter) params.set("created_after", opts.createdAfter);
    if (opts?.folderId) params.set("folder_id", opts.folderId);
    const qs = params.toString();
    return this.request(`/notes${qs ? `?${qs}` : ""}`);
  }

  /**
   * Fetch notes in a date window, newest-first. Pages with `cursor` and
   * stops as soon as items fall below `since`. Mirrors the Roam helper
   * so the unified meetings layer has parity.
   *
   * Note: Granola's list endpoint does NOT return participants — that field
   * only exists on the detail payload. So `participantFilter` is intentionally
   * absent here; the unified `listMeetings()` layer applies filtering only
   * for Roam, and surfaces unfiltered Granola items.
   */
  async listNotesInRange(opts: {
    since?: string;
    until?: string;
    max?: number;
  } = {}): Promise<GranolaNoteListItem[]> {
    const max = opts.max ?? 50;
    const sinceTime = opts.since ? new Date(opts.since).getTime() : -Infinity;
    const untilTime = opts.until ? new Date(opts.until).getTime() : Infinity;
    const out: GranolaNoteListItem[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await this.listNotes({ limit: 50, cursor });
      for (const n of res.notes) {
        const ts = new Date(n.created_at).getTime();
        if (ts < sinceTime) return out;
        if (ts > untilTime) continue;
        out.push(n);
        if (out.length >= max) return out;
      }
      if (!res.hasMore || !res.cursor) break;
      cursor = res.cursor;
    }
    return out;
  }

  /**
   * Full note detail. Pass `includeTranscript: true` to also fetch the
   * cue list (Granola charges a separate API call internally for this).
   */
  async getNote(
    noteId: string,
    opts?: { includeTranscript?: boolean },
  ): Promise<GranolaNoteDetail> {
    const params = new URLSearchParams();
    if (opts?.includeTranscript) params.set("include", "transcript");
    const qs = params.toString();
    return this.request(`/notes/${encodeURIComponent(noteId)}${qs ? `?${qs}` : ""}`);
  }

  /**
   * List folders in the workspace (paginated, sorted alphabetically by Granola).
   * Hierarchy is conveyed via `parent_folder_id`. Available since API v1.1.0 —
   * older workspaces / tokens 404 here.
   */
  async listFolders(opts?: {
    cursor?: string;
    limit?: number;
  }): Promise<{ folders: GranolaFolder[]; hasMore: boolean; cursor: string | null }> {
    const params = new URLSearchParams();
    if (opts?.cursor) params.set("cursor", opts.cursor);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.request(`/folders${qs ? `?${qs}` : ""}`);
  }

  /** Fetch every folder, following pagination. Convenience over listFolders(). */
  async listAllFolders(): Promise<GranolaFolder[]> {
    const out: GranolaFolder[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await this.listFolders({ limit: 100, cursor });
      out.push(...res.folders);
      if (!res.hasMore || !res.cursor) break;
      cursor = res.cursor;
    }
    return out;
  }
}

// ─── Helpers ──────────────────────────────────────────────

/**
 * Render a transcript into the same `[HH:MM] Speaker: text` format Roam's
 * `cuesToText` produces — letting downstream prompts treat both providers
 * uniformly. Granola lines without `start_time` get no `[HH:MM]` prefix.
 */
export function transcriptToText(lines: GranolaTranscriptLine[]): string {
  return lines
    .map((line) => {
      const speaker =
        line.speaker?.name ??
        (line.speaker?.source === "microphone" ? "Host" : "Guest");
      if (!line.start_time) return `${speaker}: ${line.text}`;
      const t = new Date(line.start_time);
      const hh = String(t.getUTCHours()).padStart(2, "0");
      const mm = String(t.getUTCMinutes()).padStart(2, "0");
      return `[${hh}:${mm}] ${speaker}: ${line.text}`;
    })
    .join("\n");
}

/**
 * Build a GranolaClient from an explicit token. Use this when the token
 * is per-member (loaded from MemberIntegration via the Supabase Vault RPC).
 */
export function buildGranolaClient(token: string | null | undefined): GranolaClient | null {
  const trimmed = token?.trim();
  if (!trimmed) return null;
  return new GranolaClient(trimmed);
}

/**
 * Env-fallback accessor. Reads GRANOLA_KEY from env; returns null when
 * the workspace hasn't set it. Kept for migration purposes — production
 * callers should prefer the per-member token via `getMemberGranolaClient`.
 *
 * @deprecated prefer getMemberGranolaClient(memberId) for user-scoped access.
 */
export function getGranolaClient(): GranolaClient | null {
  return buildGranolaClient(process.env.GRANOLA_KEY);
}
