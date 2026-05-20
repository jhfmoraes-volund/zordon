import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// ClientInsight context loader.
//
// Aggregates per-project context across all of a client's projects into a
// single payload suitable for the relational+technical LLM calls. We keep
// per-project numbers (so the LLM can attribute a risk to "Project X" and not
// fabricate a client-wide average that hides imbalance) and roll up meetings
// across all linked projects.
//
// Like the project loader, we exclude Meeting.type = 'private' explicitly.

type Client = SupabaseClient<Database>;

const MEETING_WINDOW_DAYS = 14;
const TRANSCRIPT_HEAD = 1200;
const TRANSCRIPT_TAIL = 1200;
const NOTES_MAX = 1200;
const MAX_MEETINGS = 25;

export type ClientMeetingExcerpt = {
  id: string;
  projectId: string;
  projectName: string;
  date: string;
  type: string;
  title: string | null;
  notes: string | null;
  transcriptExcerpt: string | null;
};

export type ClientProjectSnapshot = {
  id: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  activeSprintName: string | null;
  activeSprintEndDate: string | null;
  activeSprintFpDone: number;
  activeSprintFpTotal: number;
  activeSprintTaskCount: {
    todo: number;
    in_progress: number;
    review: number;
    blocked: number;
    done: number;
  };
  activeSprintDeployedToStaging: boolean;
  activeSprintDeployedToProduction: boolean;
  alerts: string[];
};

export type ClientInsightContext = {
  client: { id: string; name: string };
  projects: ClientProjectSnapshot[];
  meetings: ClientMeetingExcerpt[];
};

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

export async function loadClientInsightContext(
  client: Client,
  clientId: string,
): Promise<ClientInsightContext> {
  const { data: clientRow, error: clientErr } = await client
    .from("Client")
    .select("id, name")
    .eq("id", clientId)
    .single();
  if (clientErr || !clientRow) {
    throw new Error(`client ${clientId} not found: ${clientErr?.message}`);
  }

  // All projects of the client (active + completed); the LLM gets to see
  // momentum on closed ones too.
  const { data: projectsRaw } = await client
    .from("Project")
    .select("id, name, status, startDate, endDate")
    .eq("clientId", clientId)
    .order("createdAt", { ascending: false });

  const projectsList = projectsRaw ?? [];
  if (projectsList.length === 0) {
    return {
      client: clientRow,
      projects: [],
      meetings: [],
    };
  }

  const projectIds = projectsList.map((p) => p.id);

  // Active sprint per project.
  const { data: activeSprints } = await client
    .from("Sprint")
    .select(
      "id, projectId, name, endDate, deployedToStagingAt, deployedToProductionAt",
    )
    .in("projectId", projectIds)
    .eq("status", "active");

  const activeByProject = new Map<string, NonNullable<typeof activeSprints>[number]>();
  for (const s of activeSprints ?? []) {
    if (s.projectId) activeByProject.set(s.projectId, s);
  }

  // Tasks of active sprints — for fp + status counts.
  const activeSprintIds = (activeSprints ?? []).map((s) => s.id);
  const { data: activeSprintTasks } = activeSprintIds.length
    ? await client
        .from("Task")
        .select("status, functionPoints, sprintId")
        .in("sprintId", activeSprintIds)
    : { data: [] as Array<{ status: string; functionPoints: number | null; sprintId: string | null }> };

  const tasksBySprint = new Map<string, Array<{ status: string; functionPoints: number | null }>>();
  for (const t of activeSprintTasks ?? []) {
    if (!t.sprintId) continue;
    const arr = tasksBySprint.get(t.sprintId) ?? [];
    arr.push({ status: t.status, functionPoints: t.functionPoints });
    tasksBySprint.set(t.sprintId, arr);
  }

  const projects: ClientProjectSnapshot[] = projectsList.map((p) => {
    const sprint = activeByProject.get(p.id);
    const tasks = sprint ? tasksBySprint.get(sprint.id) ?? [] : [];
    const fpTotal = tasks.reduce((acc, t) => acc + (t.functionPoints ?? 0), 0);
    const fpDone = tasks
      .filter((t) => t.status === "done")
      .reduce((acc, t) => acc + (t.functionPoints ?? 0), 0);
    const taskCount = { todo: 0, in_progress: 0, review: 0, blocked: 0, done: 0 };
    for (const t of tasks) {
      if (t.status in taskCount) {
        taskCount[t.status as keyof typeof taskCount]++;
      }
    }

    const alerts: string[] = [];
    if (sprint && sprint.endDate) {
      const daysLeft = Math.max(
        0,
        Math.floor((new Date(sprint.endDate).getTime() - Date.now()) / 86_400_000),
      );
      if (daysLeft <= 2 && fpDone < fpTotal * 0.7 && fpTotal > 0) {
        alerts.push(
          `sprint termina em ${daysLeft}d com ${fpDone}/${fpTotal} FP feitos`,
        );
      }
      if (!sprint.deployedToStagingAt && fpDone > 0) {
        alerts.push("staging sem deploy nesta sprint");
      }
      if (taskCount.blocked > 0) {
        alerts.push(`${taskCount.blocked} task(s) bloqueada(s)`);
      }
    }

    return {
      id: p.id,
      name: p.name,
      status: p.status,
      startDate: isoDate(p.startDate),
      endDate: isoDate(p.endDate),
      activeSprintName: sprint?.name ?? null,
      activeSprintEndDate: isoDate(sprint?.endDate ?? null),
      activeSprintFpDone: fpDone,
      activeSprintFpTotal: fpTotal,
      activeSprintTaskCount: taskCount,
      activeSprintDeployedToStaging: !!sprint?.deployedToStagingAt,
      activeSprintDeployedToProduction: !!sprint?.deployedToProductionAt,
      alerts,
    };
  });

  // Meetings: linked to any project of this client, last 14 days, non-private.
  const cutoff = new Date(Date.now() - MEETING_WINDOW_DAYS * 86_400_000).toISOString();

  const { data: links } = await client
    .from("MeetingProjectLink")
    .select("meetingId, projectId")
    .in("projectId", projectIds);

  const meetingIds = Array.from(new Set((links ?? []).map((l) => l.meetingId)));
  const projectNameById = new Map(projectsList.map((p) => [p.id, p.name]));
  const projectByMeeting = new Map<string, string>(); // meetingId → projectId (first link wins)
  for (const l of links ?? []) {
    if (!projectByMeeting.has(l.meetingId)) {
      projectByMeeting.set(l.meetingId, l.projectId);
    }
  }

  const { data: meetingsRaw } = meetingIds.length
    ? await client
        .from("Meeting")
        .select("id, date, type, title, notes, transcript")
        .in("id", meetingIds)
        .neq("type", "private")
        .gte("date", cutoff)
        .order("date", { ascending: false })
        .limit(MAX_MEETINGS)
    : { data: [] as Array<{ id: string; date: string; type: string; title: string | null; notes: string | null; transcript: string | null }> };

  const meetings: ClientMeetingExcerpt[] = (meetingsRaw ?? []).map((m) => {
    const projectId = projectByMeeting.get(m.id) ?? "";
    return {
      id: m.id,
      projectId,
      projectName: projectNameById.get(projectId) ?? "(?)",
      date: isoDate(m.date) ?? "",
      type: m.type,
      title: m.title,
      notes: truncateNotes(m.notes),
      transcriptExcerpt: truncateTranscript(m.transcript),
    };
  });

  return {
    client: clientRow,
    projects,
    meetings,
  };
}
