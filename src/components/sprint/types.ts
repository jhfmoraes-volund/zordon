// Sprint domain types — independent of story-hierarchy but designed to work
// alongside it (Task carries `sprintId`).

export type SprintStatus = "upcoming" | "active" | "completed";

export type Sprint = {
  id: string;
  name: string;
  /** ISO date YYYY-MM-DD. */
  startDate: string;
  /** ISO date YYYY-MM-DD. */
  endDate: string;
  status: SprintStatus;
  deployedToStagingAt?: string | null;
  deployedToProductionAt?: string | null;
  /** Sprint Goal — manifesto de objetivo, opcional, max 280 chars. */
  goal?: string | null;
};

export const SPRINT_GOAL_MAX_LENGTH = 280;

export type SprintRetrospective = {
  id: string;
  sprintId: string;
  goodPoints: string | null;
  badPoints: string | null;
  ideas: string | null;
  completedAt: string;
  completedBy: string | null;
};

export type SprintMemberCapacity = {
  sprintId: string;
  memberId: string;
  /** Total PFV capacity of this member during this sprint. */
  fpCapacity: number;
  /** PFV allocated (planned) to this member in this sprint. */
  fpAllocation: number;
};
