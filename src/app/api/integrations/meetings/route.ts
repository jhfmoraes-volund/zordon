import { NextResponse } from "next/server";
import { getCurrentMember, requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import { getMemberIntegrationToken } from "@/lib/member-integrations";
import {
  RoamClient,
  type RoamTranscriptListItem,
} from "@/lib/roam";
import {
  GranolaClient,
  buildGranolaClient,
  type GranolaNoteListItem,
  type GranolaNoteDetail,
} from "@/lib/granola";
import type { MeetingSource } from "@/lib/meetings";

/**
 * GET /api/integrations/meetings
 *
 * Returns the caller's last ~30 importable meetings from every provider in
 * parallel, normalized to a single shape. Used by the "Importar reunião"
 * sheet to power the source-picker tabs (Roam / Granola).
 *
 * Granola's list endpoint does NOT return attendees, so we fan out N parallel
 * detail fetches (capped concurrency) to hydrate participants + duration for
 * the cards. Worst case is ~30 requests against Granola's 5 req/s budget —
 * the semaphore keeps us under the burst limit.
 */

export interface ImportableMeeting {
  source: MeetingSource;
  id: string;
  title: string;
  start: string; // ISO 8601
  end?: string;
  durationMinutes?: number;
  participants: { name: string; email?: string }[];
  ownerName?: string;
}

export interface SourceResult {
  needsAuth: boolean;
  available: ImportableMeeting[];
  error?: string;
}

export interface MeetingsImportResponse {
  sources: Record<MeetingSource, SourceResult>;
}

const MAX_PER_SOURCE = 30;
const GRANOLA_DETAIL_CONCURRENCY = 4;

export async function GET() {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 403 });
  }

  const [roamToken, granolaToken] = await Promise.all([
    getMemberIntegrationToken(member.id, "roam"),
    getMemberIntegrationToken(member.id, "granola"),
  ]);

  const [roam, granola] = await Promise.all([
    loadRoam(roamToken),
    loadGranola(buildGranolaClient(granolaToken)),
  ]);

  return NextResponse.json({ sources: { roam, granola } } satisfies MeetingsImportResponse);
}

// ─── Roam ─────────────────────────────────────────────────

async function loadRoam(token: string | null): Promise<SourceResult> {
  if (!token) return { needsAuth: true, available: [] };

  try {
    const client = new RoamClient(token);
    const transcripts = await client.listTranscriptsInRange({ max: MAX_PER_SOURCE });
    return { needsAuth: false, available: transcripts.map(normalizeRoam) };
  } catch (err) {
    const msg = (err as Error).message || "";
    return {
      needsAuth: false,
      available: [],
      error:
        msg.includes("401") || msg.includes("403")
          ? "Token Roam inválido ou expirado — reconecte em /settings/integrations."
          : `Falha ao listar reuniões do Roam: ${msg}`,
    };
  }
}

function normalizeRoam(t: RoamTranscriptListItem): ImportableMeeting {
  const durationMinutes = Math.max(
    1,
    Math.round((new Date(t.end).getTime() - new Date(t.start).getTime()) / 60000),
  );
  return {
    source: "roam",
    id: t.id,
    title: t.eventName?.trim() || "Sem título",
    start: t.start,
    end: t.end,
    durationMinutes,
    participants: t.participants.map((p) => ({ name: p.name, email: p.email })),
  };
}

// ─── Granola ──────────────────────────────────────────────

async function loadGranola(client: GranolaClient | null): Promise<SourceResult> {
  // Granola is workspace-scoped via env; "needsAuth" here means "GRANOLA_KEY
  // missing on this deploy" — there's no per-user OAuth flow to surface.
  if (!client) return { needsAuth: true, available: [] };

  try {
    const notes = await client.listNotesInRange({ max: MAX_PER_SOURCE });
    const enriched = await mapWithConcurrency(
      notes,
      GRANOLA_DETAIL_CONCURRENCY,
      async (n) => {
        try {
          const detail = await client.getNote(n.id, { includeTranscript: false });
          return normalizeGranola(n, detail);
        } catch {
          // Detail failed for a single note — degrade gracefully with what
          // the list gave us; the user can still pick this meeting.
          return normalizeGranola(n, null);
        }
      },
    );
    return { needsAuth: false, available: enriched };
  } catch (err) {
    const msg = (err as Error).message || "";
    return {
      needsAuth: false,
      available: [],
      error:
        msg.includes("401") || msg.includes("403")
          ? "Chave Granola inválida (GRANOLA_KEY) — peça ao admin para revisar."
          : `Falha ao listar reuniões do Granola: ${msg}`,
    };
  }
}

function normalizeGranola(
  list: GranolaNoteListItem,
  detail: GranolaNoteDetail | null,
): ImportableMeeting {
  const start = detail?.calendar_event?.scheduled_start_time ?? list.created_at;
  const end = detail?.calendar_event?.scheduled_end_time;
  const durationMinutes = end
    ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
    : undefined;

  // Prefer attendees (name + email); fall back to calendar invitees (email only).
  const participants: { name: string; email?: string }[] =
    detail?.attendees?.map((a) => ({
      name: a.name ?? a.email ?? "",
      email: a.email,
    })) ??
    detail?.calendar_event?.invitees?.map((i) => ({
      name: i.name ?? i.email,
      email: i.email,
    })) ??
    [];

  return {
    source: "granola",
    id: list.id,
    title: list.title?.trim() || detail?.calendar_event?.event_title || "Sem título",
    start,
    end,
    durationMinutes,
    participants,
    ownerName: list.owner?.name,
  };
}

// ─── Utility ──────────────────────────────────────────────

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
