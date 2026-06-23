// Status chips for the story hierarchy, mapped to the existing chromatic
// `StatusChip` primitive. Single source of truth for refinement / computed /
// task-status presentation.

import { StatusChip } from "@/components/ui/status-chip";
import type { ChipTone } from "@/lib/status-chips";
import type {
  ComputedStatus,
  RefinementStatus,
  TaskStatus,
} from "./types";

export const REFINEMENT_MAP: Record<
  RefinementStatus,
  { label: string; tone: ChipTone }
> = {
  draft:     { label: "Rascunho",     tone: "amber" },
  committed: { label: "Comprometida", tone: "brand" },
};

export const COMPUTED_MAP: Record<
  ComputedStatus,
  { label: string; tone: ChipTone }
> = {
  pending:        { label: "Pending",        tone: "muted"  },
  in_progress:    { label: "In progress",    tone: "amber"  },
  tasks_complete: { label: "Tasks complete", tone: "purple" },
  done:           { label: "Done",           tone: "green"  },
};

export const TASK_STATUS_MAP: Record<
  TaskStatus,
  { label: string; tone: ChipTone }
> = {
  draft:       { label: "Draft",       tone: "amber"  },
  backlog:     { label: "Backlog",     tone: "muted"  },
  todo:        { label: "To do",       tone: "blue"   },
  in_progress: { label: "In progress", tone: "amber"  },
  blocked:     { label: "Blocked",     tone: "red"    },
  review:      { label: "Review",      tone: "purple" },
  done:        { label: "Done",        tone: "green"  },
};

export function RefinementChip({ status }: { status: RefinementStatus }) {
  const s = REFINEMENT_MAP[status];
  return <StatusChip tone={s.tone}>{s.label}</StatusChip>;
}

export function ComputedStatusChip({ status }: { status: ComputedStatus }) {
  const s = COMPUTED_MAP[status];
  return (
    <StatusChip tone={s.tone} dot>
      {s.label}
    </StatusChip>
  );
}

export function TaskStatusChip({ status }: { status: TaskStatus }) {
  const s = TASK_STATUS_MAP[status];
  return (
    <StatusChip tone={s.tone} dot>
      {s.label}
    </StatusChip>
  );
}
