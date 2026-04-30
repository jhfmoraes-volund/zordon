// Sprint domain types — independent of story-hierarchy but designed to work
// alongside it (Task carries `sprintId`).

export type SprintStatus = "planning" | "active" | "completed";

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
};

export type SprintMemberCapacity = {
  sprintId: string;
  memberId: string;
  /** Total FP capacity of this member during this sprint. */
  fpCapacity: number;
  /** FP allocated (planned) to this member in this sprint. */
  fpAllocation: number;
};
