// Single source of truth for status/type chips across the app.
// Each entry maps a domain value to { label, tone } — labels are user-facing,
// tones map to chromatic styles defined in components/ui/status-chip.tsx.

export type ChipTone =
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "purple"
  | "cyan"
  | "teal"
  | "pink"
  | "slate"
  | "brand"
  | "muted";

export type ChipDescriptor = {
  label: string;
  tone: ChipTone;
};

function defineRegistry<T extends Record<string, ChipDescriptor>>(r: T): T {
  return r;
}

// ─── Meeting ─────────────────────────────────────────────

export const MEETING_STATUS = defineRegistry({
  scheduled:   { label: "Agendada",     tone: "blue" },
  in_progress: { label: "Em andamento", tone: "amber" },
  done:        { label: "Concluída",    tone: "green" },
});

export const MEETING_TYPE = defineRegistry({
  daily:          { label: "Daily",          tone: "cyan" },
  pm_review:      { label: "PMs",            tone: "purple" },
  general:        { label: "Geral",          tone: "slate" },
  super_planning: { label: "Super Planning", tone: "amber" },
});

// ─── Project ─────────────────────────────────────────────

export const PROJECT_STATUS = defineRegistry({
  active:    { label: "Ativo",     tone: "green" },
  paused:    { label: "Pausado",   tone: "amber" },
  completed: { label: "Concluído", tone: "blue"  },
  archived:  { label: "Arquivado", tone: "muted" },
});

// ─── Task ────────────────────────────────────────────────

export const TASK_STATUS = defineRegistry({
  draft:       { label: "Rascunho",    tone: "amber"  },
  backlog:     { label: "Backlog",     tone: "muted"  },
  todo:        { label: "To Do",       tone: "blue"   },
  in_progress: { label: "In Progress", tone: "amber"  },
  review:      { label: "Review",      tone: "purple" },
  done:        { label: "Done",        tone: "green"  },
});

export const TASK_TYPE = defineRegistry({
  setup:      { label: "Setup",      tone: "purple" },
  feature:    { label: "Feature",    tone: "blue"   },
  component:  { label: "Componente", tone: "teal"   },
  seed:       { label: "Seed",       tone: "amber"  },
  bugfix:     { label: "Bugfix",     tone: "red"    },
  refactor:   { label: "Refactor",   tone: "slate"  },
  management: { label: "Gestão",     tone: "pink"   },
});

// ─── Sprint ──────────────────────────────────────────────

export const SPRINT_STATUS = defineRegistry({
  planning:  { label: "Planning",  tone: "muted" },
  active:    { label: "Ativo",     tone: "green" },
  completed: { label: "Concluído", tone: "blue"  },
});

// ─── Design Session ──────────────────────────────────────

export const DESIGN_SESSION_STATUS = defineRegistry({
  draft:       { label: "Rascunho",    tone: "muted" },
  in_progress: { label: "Em andamento", tone: "amber" },
  done:        { label: "Concluída",    tone: "green" },
});

// ─── Deploy / environment ────────────────────────────────

export const DEPLOY_STATUS = defineRegistry({
  pending:     { label: "Pendente",   tone: "muted" },
  deploying:   { label: "Deployando", tone: "amber" },
  success:     { label: "Sucesso",    tone: "green" },
  failed:      { label: "Falhou",     tone: "red"   },
  rolled_back: { label: "Rollback",   tone: "amber" },
});

export const ENVIRONMENT = defineRegistry({
  development: { label: "Development", tone: "blue"   },
  staging:     { label: "Staging",     tone: "amber"  },
  production:  { label: "Production",  tone: "green"  },
  sandbox:     { label: "Sandbox",     tone: "purple" },
});

// ─── Health ──────────────────────────────────────────────

export const HEALTH = defineRegistry({
  healthy:   { label: "Saudável", tone: "green" },
  attention: { label: "Atenção",  tone: "amber" },
  critical:  { label: "Crítico",  tone: "red"   },
});

// ─── Action (meeting task actions) ───────────────────────

export const ACTION_TYPE = defineRegistry({
  create: { label: "Criar",     tone: "green"  },
  update: { label: "Atualizar", tone: "blue"   },
  delete: { label: "Remover",   tone: "red"    },
  move:   { label: "Mover",     tone: "purple" },
  review: { label: "Revisar",   tone: "amber"  },
});

// ─── To-do / Action-item status ──────────────────────────
// (red=todo is intentional — pending actions read as "warning" until done)

export const ACTION_ITEM_STATUS = defineRegistry({
  todo:  { label: "TODO",  tone: "red"   },
  doing: { label: "DOING", tone: "amber" },
  done:  { label: "DONE",  tone: "green" },
});

// ─── Complexity & Scope ──────────────────────────────────

export const COMPLEXITY = defineRegistry({
  trivial: { label: "Trivial", tone: "muted" },
  low:     { label: "Baixa",   tone: "blue"  },
  medium:  { label: "Média",   tone: "amber" },
  high:    { label: "Alta",    tone: "red"   },
});

export const SCOPE = defineRegistry({
  micro:  { label: "Micro",  tone: "muted" },
  small:  { label: "Small",  tone: "blue"  },
  medium: { label: "Medium", tone: "amber" },
  large:  { label: "Large",  tone: "red"   },
});

// ─── Helpers ─────────────────────────────────────────────

export function lookupChip<T extends Record<string, ChipDescriptor>>(
  registry: T,
  key: string | null | undefined,
): ChipDescriptor {
  if (key && key in registry) return registry[key as keyof T];
  return { label: key ?? "—", tone: "muted" };
}
