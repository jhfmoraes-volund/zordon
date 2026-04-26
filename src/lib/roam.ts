import "server-only";

// ─── Types (from real API responses) ──────────────────────

export interface RoamParticipant {
  type: "member" | "guest";
  name: string;
  email?: string;
  user: string; // U-xxx for members, V-xxx for guests
}

export interface RoamTranscriptListItem {
  id: string;
  meetingId: string;
  start: string; // ISO 8601
  end: string;
  participants: RoamParticipant[];
  eventName?: string;
  meetingLinkId?: string;
  invitees?: string[];
}

export interface RoamCue {
  speaker: string;
  text: string;
  start: string; // ISO 8601
  end: string;
  startOffset: number;
  endOffset: number;
}

export interface RoamActionItem {
  title: string;
  description: string;
}

export interface RoamTranscriptDetail extends RoamTranscriptListItem {
  cues: RoamCue[];
  summary: string;
  actionItems: RoamActionItem[];
}

export interface RoamUser {
  id: string;
  name: string;
  email?: string;
  status?: string;
}

// ─── Client ───────────────────────────────────────────────

/**
 * Roam HQ API client — v0 (Chat API Alpha).
 * Base URL: https://api.ro.am/v0
 *
 * Tokens are per-user (scoped to the PM who generated them in Roam).
 * Load via `getMemberRoamToken()` from member-integrations, then pass in.
 *
 * Endpoints used:
 *   GET  /transcript.list  — list transcripts (paginated)
 *   GET  /transcript.info  — full transcript with cues, summary, action items
 *   POST /transcript.prompt — ask AI about a transcript
 *   GET  /user.list        — list workspace users
 */
export class RoamClient {
  private baseUrl = "https://api.ro.am/v0";
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("Roam API key is required");
    this.apiKey = apiKey;
  }

  private async request<T>(
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Roam API ${res.status}: ${body || res.statusText}`);
    }

    return res.json() as Promise<T>;
  }

  /**
   * List meeting transcripts, optionally filtered by date range.
   * Returns up to 10 per page (default). Use cursor for pagination.
   */
  async listTranscripts(opts?: {
    after?: string; // ISO date
    before?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    transcripts: RoamTranscriptListItem[];
    nextCursor?: string;
  }> {
    const params = new URLSearchParams();
    if (opts?.after) params.set("after", opts.after);
    if (opts?.before) params.set("before", opts.before);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.cursor) params.set("cursor", opts.cursor);
    const qs = params.toString();

    return this.request(`/transcript.list${qs ? `?${qs}` : ""}`);
  }

  /**
   * Fetch transcripts in a date window, newest-first.
   *
   * Pages with `cursor` to avoid the gotcha in `transcript.list`: when `after`
   * is supplied, the API anchors there and returns ASC, truncating the most
   * recent window when results exceed `limit` (and silently sets `nextCursor`).
   * This helper iterates DESC pages without `after` and stops when items
   * fall below `since`.
   */
  async listTranscriptsInRange(opts: {
    since?: string;
    until?: string;
    max?: number;
  } = {}): Promise<RoamTranscriptListItem[]> {
    const max = opts.max ?? 50;
    const sinceTime = opts.since ? new Date(opts.since).getTime() : -Infinity;
    const untilTime = opts.until ? new Date(opts.until).getTime() : Infinity;
    const out: RoamTranscriptListItem[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await this.listTranscripts({ limit: 50, cursor });
      for (const t of res.transcripts) {
        const ts = new Date(t.start).getTime();
        if (ts < sinceTime) return out;
        if (ts > untilTime) continue;
        out.push(t);
        if (out.length >= max) return out;
      }
      if (!res.nextCursor) break;
      cursor = res.nextCursor;
    }
    return out;
  }

  /**
   * Get full transcript detail: cues (speaker + text + timestamps),
   * AI-generated summary, and action items.
   */
  async getTranscript(transcriptId: string): Promise<RoamTranscriptDetail> {
    return this.request(`/transcript.info?id=${transcriptId}`);
  }

  /**
   * Ask an AI question about a specific transcript.
   * Returns a text answer.
   */
  async promptTranscript(
    transcriptId: string,
    prompt: string
  ): Promise<{ answer: string }> {
    return this.request("/transcript.prompt", {
      method: "POST",
      body: JSON.stringify({ id: transcriptId, prompt }),
    });
  }

  /**
   * List workspace users with email and status info.
   */
  async listUsers(opts?: {
    limit?: number;
    cursor?: string;
  }): Promise<{ users: RoamUser[]; nextCursor?: string }> {
    const params = new URLSearchParams();
    params.set("expand", "email,status");
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.cursor) params.set("cursor", opts.cursor);

    return this.request(`/user.list?${params.toString()}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────

/**
 * Convert transcript cues into a readable text block for AI processing.
 * Format: [HH:MM] Speaker: text
 */
export function cuesToText(cues: RoamCue[]): string {
  return cues
    .map((cue) => {
      const time = new Date(cue.start);
      const hh = String(time.getUTCHours()).padStart(2, "0");
      const mm = String(time.getUTCMinutes()).padStart(2, "0");
      return `[${hh}:${mm}] ${cue.speaker}: ${cue.text}`;
    })
    .join("\n");
}
