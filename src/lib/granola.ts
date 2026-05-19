import "server-only";

// ─── Types (from Granola public API v1) ───────────────────

export interface GranolaParticipant {
  name: string;
  email?: string;
}

export interface GranolaNoteListItem {
  id: string;
  title: string;
  createdAt: string; // ISO 8601
  owner?: { name: string; email?: string };
  participants?: GranolaParticipant[];
  summary?: string;
}

export interface GranolaTranscriptLine {
  speaker?: { source?: "microphone" | "speaker"; name?: string };
  text: string;
}

export interface GranolaNoteDetail extends GranolaNoteListItem {
  transcript?: GranolaTranscriptLine[];
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
 *   GET /notes/{id}?include=transcript        — full note detail
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
  }): Promise<{ notes: GranolaNoteListItem[]; hasMore: boolean; cursor?: string }> {
    const params = new URLSearchParams();
    if (opts?.cursor) params.set("cursor", opts.cursor);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.createdAfter) params.set("created_after", opts.createdAfter);
    const qs = params.toString();
    return this.request(`/notes${qs ? `?${qs}` : ""}`);
  }

  /**
   * Fetch notes in a date window, newest-first. Pages with `cursor` and
   * stops as soon as items fall below `since`. Mirrors the Roam helper
   * so the unified meetings layer has parity.
   */
  async listNotesInRange(opts: {
    since?: string;
    until?: string;
    max?: number;
    participantFilter?: (participantNames: string[]) => boolean;
  } = {}): Promise<GranolaNoteListItem[]> {
    const max = opts.max ?? 50;
    const sinceTime = opts.since ? new Date(opts.since).getTime() : -Infinity;
    const untilTime = opts.until ? new Date(opts.until).getTime() : Infinity;
    const out: GranolaNoteListItem[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await this.listNotes({ limit: 50, cursor });
      for (const n of res.notes) {
        const ts = new Date(n.createdAt).getTime();
        if (ts < sinceTime) return out;
        if (ts > untilTime) continue;
        if (opts.participantFilter) {
          const names = (n.participants ?? []).map((p) => p.name);
          if (!opts.participantFilter(names)) continue;
        }
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
}

// ─── Helpers ──────────────────────────────────────────────

/**
 * Render a transcript (speaker + text) into the same `[HH:MM] Speaker: text`
 * format used by Roam's `cuesToText`. Granola lines have no timestamps, so
 * the prefix is omitted — keeping the format readable by the same prompts.
 */
export function transcriptToText(lines: GranolaTranscriptLine[]): string {
  return lines
    .map((line) => {
      const speaker =
        line.speaker?.name ??
        (line.speaker?.source === "microphone" ? "Host" : "Guest");
      return `${speaker}: ${line.text}`;
    })
    .join("\n");
}

/**
 * Singleton accessor. Reads GRANOLA_KEY from env; returns null when the
 * workspace has not configured an API key — callers should treat that
 * the same way they treat a missing Roam token (i.e. degrade gracefully).
 */
export function getGranolaClient(): GranolaClient | null {
  const key = process.env.GRANOLA_KEY?.trim();
  if (!key) return null;
  return new GranolaClient(key);
}
