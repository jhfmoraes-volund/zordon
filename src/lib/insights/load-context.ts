import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// Build the InsightContext payload for one project.
//
// Read-only. Expects an admin (service-role) client because we call this from
// the cron API route which has no user JWT. Visibility/redaction is enforced
// by the filters we apply here, NOT by RLS — in particular, Meeting.type =
// 'private' is excluded explicitly. The day a new private-equivalent type is
// added, this query has to be updated.

type Client = SupabaseClient<Database>;

export type MeetingExcerpt = {
  id: string;
  date: string;
  type: string;
  title: string | null;
  notes: string | null;
  transcriptExcerpt: string | null;
};

export type SprintSnapshot = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  goal: string | null;
  deployedToStagingAt: string | null;
  deployedToProductionAt: string | null;
  fpDone: number;
  fpTotal: number;
  taskCount: {
    todo: number;
    in_progress: number;
    review: number;
    blocked: number;
    done: number;
  };
};

export type MemberAllocation = {
  id: string;
  name: string;
  role: string | null;
  fpCapacity: number;
  fpAllocated: number;
};

export type InsightContext = {
  project: {
    id: string;
    name: string;
    status: string;
    client: { name: string } | null;
    startDate: string | null;
    endDate: string | null;
    daysElapsed: number;
  };
  activeSprint: SprintSnapshot | null;
  recentSprints: SprintSnapshot[];
  members: MemberAllocation[];
  meetingsForRelational: MeetingExcerpt[];
  sprintAlerts: string[];
};

const MEETING_WINDOW_DAYS = 14;
const TRANSCRIPT_HEAD = 1500;
const TRANSCRIPT_TAIL = 1500;
const NOTES_MAX = 1500;
const RECENT_CLOSED_SPRINTS = 3;

function isoDate(d: string | Date | null): string | null {
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

function truncateNotes(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= NOTES_MAX) return trimmed;
  return trimmed.slice(0, NOTES_MAX) + "\n…[truncated]";
}

function truncateTranscript(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= TRANSCRIPT_HEAD + TRANSCRIPT_TAIL) return trimmed;
  return (
    trimmed.slice(0, TRANSCRIPT_HEAD) +
    "\n\n…[middle truncated]…\n\n" +
    trimmed.slice(-TRANSCRIPT_TAIL)
  );
}

export async function loadInsightContext(
  client: Client,
  projectId: string,
): Promise<InsightContext> {
  // 1. Project + client.
  const { data: project, error: projectErr } = await client
    .from("Project")
    .select(`id, name, status, startDate, endDate, client:Client(name)`)
    .eq("id", projectId)
    .single();
  if (projectErr || !project) {
    throw new Error(`project ${projectId} not found: ${projectErr?.message}`);
  }

  const daysElapsed = project.startDate
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(project.startDate).getTime()) / 86_400_000,
        ),
      )
    : 0;

  // 2. Sprints: active + 3 most recent closed.
  const { data: sprintsRaw } = await client
    .from("Sprint")
    .select(`
      id, name, startDate, endDate, status, goal,
      deployedToStagingAt, deployedToProductionAt
    `)
    .eq("projectId", projectId)
    .in("status", ["active", "completed"])
    .order("startDate", { ascending: false })
    .limit(RECENT_CLOSED_SPRINTS + 1);

  const sprintsList = sprintsRaw ?? [];
  const sprintIds = sprintsList.map((s) => s.id);

  // 3. Tasks per sprint — used to compute FP done/total and status mix.
  const { data: tasks } = sprintIds.length
    ? await client
        .from("Task")
        .select("id, status, functionPoints, sprintId")
        .eq("projectId", projectId)
        .in("sprintId", sprintIds)
    : { data: [] as Array<{ id: string; status: string; functionPoints: number | null; sprintId: string | null }> };

  const tasksBySprint = new Map<string, NonNullable<typeof tasks>>();
  for (const t of tasks ?? []) {
    if (!t.sprintId) continue;
    const arr = tasksBySprint.get(t.sprintId) ?? [];
    arr.push(t);
    tasksBySprint.set(t.sprintId, arr);
  }

  function buildSnapshot(s: (typeof sprintsList)[number]): SprintSnapshot {
    const sprintTasks = tasksBySprint.get(s.id) ?? [];
    const fpTotal = sprintTasks.reduce((acc, t) => acc + (t.functionPoints ?? 0), 0);
    const fpDone = sprintTasks
      .filter((t) => t.status === "done")
      .reduce((acc, t) => acc + (t.functionPoints ?? 0), 0);
    const taskCount = { todo: 0, in_progress: 0, review: 0, blocked: 0, done: 0 };
    for (const t of sprintTasks) {
      if (t.status in taskCount) {
        taskCount[t.status as keyof typeof taskCount]++;
      }
    }
    return {
      id: s.id,
      name: s.name,
      startDate: isoDate(s.startDate) ?? "",
      endDate: isoDate(s.endDate) ?? "",
      status: s.status,
      goal: s.goal,
      deployedToStagingAt: isoDate(s.deployedToStagingAt),
      deployedToProductionAt: isoDate(s.deployedToProductionAt),
      fpDone,
      fpTotal,
      taskCount,
    };
  }

  const activeSprint = sprintsList.find((s) => s.status === "active");
  const recentClosed = sprintsList
    .filter((s) => s.status === "completed")
    .slice(0, RECENT_CLOSED_SPRINTS);

  // 4. Members + capacity (active sprint only). The `sprint_member_capacity`
  //    view is canonical: per (sprint, member), fp_allocation is the
  //    negotiated capacity and fp_planned is what got assigned to tasks.
  let members: MemberAllocation[] = [];

  if (activeSprint) {
    const { data: capRows } = await client
      .from("sprint_member_capacity")
      .select("memberId, member_name, fp_allocation, fp_planned")
      .eq("sprintId", activeSprint.id);

    members = (capRows ?? []).map((row) => ({
      id: row.memberId ?? "",
      name: row.member_name ?? "(?)",
      role: null,
      fpCapacity: row.fp_allocation ?? 0,
      fpAllocated: row.fp_planned ?? 0,
    }));
  }

  // 5. Meetings: last 14 days, linked to this project, NOT private.
  const cutoff = new Date(Date.now() - MEETING_WINDOW_DAYS * 86_400_000).toISOString();

  const { data: linkedMeetingIds } = await client
    .from("MeetingProjectLink")
    .select("meetingId")
    .eq("projectId", projectId);

  const meetingIds = (linkedMeetingIds ?? []).map((r) => r.meetingId);

  const { data: meetingsRaw } = meetingIds.length
    ? await client
        .from("Meeting")
        .select("id, date, type, title, notes, transcript")
        .in("id", meetingIds)
        .neq("type", "private") // hard exclusion; do not relax without PRD revisit.
        .gte("date", cutoff)
        .order("date", { ascending: false })
        .limit(20)
    : { data: [] as Array<{ id: string; date: string; type: string; title: string | null; notes: string | null; transcript: string | null }> };

  const meetings: MeetingExcerpt[] = (meetingsRaw ?? []).map((m) => ({
    id: m.id,
    date: isoDate(m.date) ?? "",
    type: m.type,
    title: m.title,
    notes: truncateNotes(m.notes),
    transcriptExcerpt: truncateTranscript(m.transcript),
  }));

  // 6. Sprint alerts: cheap pre-computed strings the LLM can quote verbatim.
  const sprintAlerts: string[] = [];
  if (activeSprint) {
    const snap = buildSnapshot(activeSprint);
    const daysLeft = Math.max(
      0,
      Math.floor((new Date(snap.endDate).getTime() - Date.now()) / 86_400_000),
    );
    if (daysLeft <= 2 && snap.fpDone < snap.fpTotal * 0.7) {
      sprintAlerts.push(
        `sprint termina em ${daysLeft}d com ${snap.fpDone}/${snap.fpTotal} FP feitos`,
      );
    }
    if (snap.deployedToStagingAt === null && snap.fpDone > 0) {
      sprintAlerts.push("staging não recebeu deploy nesta sprint");
    }
    if (snap.taskCount.blocked > 0) {
      sprintAlerts.push(`${snap.taskCount.blocked} task(s) bloqueada(s)`);
    }
  }

  return {
    project: {
      id: project.id,
      name: project.name,
      status: project.status,
      client: project.client as { name: string } | null,
      startDate: isoDate(project.startDate),
      endDate: isoDate(project.endDate),
      daysElapsed,
    },
    activeSprint: activeSprint ? buildSnapshot(activeSprint) : null,
    recentSprints: recentClosed.map(buildSnapshot),
    members,
    meetingsForRelational: meetings,
    sprintAlerts,
  };
}
