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
  scheduled: { label: "Agendada",  tone: "blue"  },
  done:      { label: "Concluída", tone: "green" },
});

// Status is derived from the meeting's calendar day: meetings whose day already
// passed are "done", today/future are "scheduled". The DB column still exists
// but is ignored at the UI layer.
export function meetingStatusFromDate(dateString: string): "scheduled" | "done" {
  const meetingDay = new Date(dateString).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return meetingDay < today ? "done" : "scheduled";
}

export const MEETING_TYPE = defineRegistry({
  daily:          { label: "Daily",          tone: "cyan" },
  pm_review:      { label: "PMs",            tone: "purple" },
  general:        { label: "Geral",          tone: "slate" },
  super_planning: { label: "Super Planning", tone: "amber" },
  private:        { label: "Privada",        tone: "pink" },
});

// Labels longos (selects, headers, títulos derivados). MEETING_TYPE.label é o
// chip curto ("PMs", "Geral"); estes são a forma por extenso. SSOT única — antes
// estavam duplicados em meeting-sheet, meetings/[id] e meetings/page (com
// "private" divergindo entre "Privada" e "Reunião privada").
export const MEETING_TYPE_LONG_LABELS: Record<keyof typeof MEETING_TYPE, string> = {
  daily: "Daily",
  pm_review: "Reunião com PMs",
  general: "Reunião geral",
  super_planning: "Super Planning",
  private: "Privada",
};

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
  blocked:     { label: "Blocked",     tone: "red"    },
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
  upcoming:  { label: "A iniciar", tone: "muted" },
  active:    { label: "Ativa",     tone: "green" },
  completed: { label: "Concluída", tone: "blue"  },
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
  todo:  { label: "To-do",        tone: "red"   },
  doing: { label: "Em andamento", tone: "amber" },
  done:  { label: "Concluído",    tone: "green" },
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

// ─── Tonal classes ───────────────────────────────────────
// Tailwind utility maps keyed by ChipTone. Centralized here so any component
// that needs to reflect a tone (chip background, full-trigger fill, dot,
// border, etc.) reads from the same source. Tailwind only ships classes that
// appear LITERALLY in source — these maps are the literal source.

/** Subtle tonal background + matching text/border. Use when you want the whole
 *  surface to take the tone (e.g. a Select trigger acting as a status badge). */
export const TONE_FILL: Record<ChipTone, string> = {
  blue:   "bg-blue-500/15 text-blue-700 border-blue-500/30 hover:bg-blue-500/20 dark:text-blue-300",
  green:  "bg-green-500/15 text-green-700 border-green-500/30 hover:bg-green-500/20 dark:text-green-300",
  amber:  "bg-amber-500/15 text-amber-700 border-amber-500/30 hover:bg-amber-500/20 dark:text-amber-300",
  red:    "bg-red-500/15 text-red-700 border-red-500/30 hover:bg-red-500/20 dark:text-red-300",
  purple: "bg-purple-500/15 text-purple-700 border-purple-500/30 hover:bg-purple-500/20 dark:text-purple-300",
  cyan:   "bg-cyan-500/15 text-cyan-700 border-cyan-500/30 hover:bg-cyan-500/20 dark:text-cyan-300",
  teal:   "bg-teal-500/15 text-teal-700 border-teal-500/30 hover:bg-teal-500/20 dark:text-teal-300",
  pink:   "bg-pink-500/15 text-pink-700 border-pink-500/30 hover:bg-pink-500/20 dark:text-pink-300",
  slate:  "bg-slate-500/15 text-slate-700 border-slate-500/30 hover:bg-slate-500/20 dark:text-slate-300",
  brand:  "bg-primary/15 text-primary border-primary/30 hover:bg-primary/20",
  muted:  "bg-muted text-muted-foreground border-border hover:bg-muted/70",
};

/** Solid dot color — for "● Label" patterns inside selects, lists, chips. */
export const TONE_DOT: Record<ChipTone, string> = {
  blue:   "bg-blue-500",
  green:  "bg-green-500",
  amber:  "bg-amber-500",
  red:    "bg-red-500",
  purple: "bg-purple-500",
  cyan:   "bg-cyan-500",
  teal:   "bg-teal-500",
  pink:   "bg-pink-500",
  slate:  "bg-slate-500",
  brand:  "bg-primary",
  muted:  "bg-muted-foreground/40",
};
