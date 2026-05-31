import type { TaskTag } from "@/components/story-hierarchy";

export type TabKey =
  | "stories"
  | "sprints"
  | "sessions"
  | "ceremonies"
  | "wiki"
  | "forge"
  | "settings";

export type ProjectMeta = {
  id: string;
  name: string;
  status: string;
  client: { name: string } | null;
  clientId: string;
  pmId: string | null;
  pm: {
    id: string;
    name: string;
    role: string | null;
    fpCapacity: number | null;
  } | null;
  repoUrl: string | null;
  startDate: string | null;
  endDate: string | null;
  githubRepoOwner: string | null;
  githubRepoName: string | null;
  githubDefaultBranch: string | null;
  referenceKey: string | null;
  definitionOfDone: string[];
};

export type RawTask = {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  status: string;
  type: string | null;
  scope: string | null;
  complexity: string | null;
  functionPoints: number | null;
  billable: boolean | null;
  dueDate: string | null;
  doneAt: string | null;
  notes: string | null;
  sprintId: string | null;
  userStoryId: string | null;
  projectId: string;
  createdByAgent: boolean | null;
  assignments: Array<{
    memberId: string;
    member: { id: string; name: string } | null;
  }>;
  tags: TaskTag[];
};

export type RawSprint = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  goal: string | null;
  deployedToStagingAt: string | null;
  deployedToProductionAt: string | null;
};

export type RawMember = {
  id: string;
  name: string;
  role: string | null;
  fpCapacity: number | null;
};

export type RawSprintMember = {
  sprintId: string;
  memberId: string;
  fpAllocation: number;
};

export type RawProjectMember = {
  memberId: string;
  fpAllocation: number;
};
