// Shape of the context payload the edge function builds before calling the
// LLM. Kept in a shared file so Next.js code that triggers reruns or renders
// debug views uses the same types as the function does.

export type InsightMeetingExcerpt = {
  id: string;
  date: string;          // ISO date, no time
  type: string;          // 'general' | 'pm_review' | 'daily' | 'super_planning' (never 'private')
  title: string | null;
  notes: string | null;          // truncated to ~1500 chars
  transcriptExcerpt: string | null; // head+tail, ~3000 chars total
};

export type InsightSprintSnapshot = {
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

export type InsightMemberAllocation = {
  id: string;
  name: string;
  role: string | null;
  fpCapacity: number;
  fpAllocated: number;
  dedicationPercent: number;
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
  activeSprint: InsightSprintSnapshot | null;
  recentSprints: InsightSprintSnapshot[]; // up to 3 most recent closed
  members: InsightMemberAllocation[];
  meetingsForRelational: InsightMeetingExcerpt[];
  sprintAlerts: string[]; // human-readable strings, pre-computed
};
