"use client";

import { Loader2, Sparkles, Search, Database, Pencil, Plus, Trash2, Check, ListTodo } from "lucide-react";

type ToolInvocationState = "partial-call" | "call" | "result";

interface ToolCallCardProps {
  toolName: string;
  args: Record<string, unknown>;
  state: ToolInvocationState;
  result?: unknown;
}

const TOOL_LABELS: Record<string, (args: Record<string, unknown>) => string> = {
  set_field: (a) => `Preenchendo ${a.field} em ${a.stepKey}`,
  add_item: (a) => `Criando item em ${a.arrayKey} (${a.stepKey})`,
  update_item: (a) => `Atualizando item em ${a.arrayKey} (${a.stepKey})`,
  delete_item: (a) => `Removendo item de ${a.arrayKey} (${a.stepKey})`,
  get_step_data: (a) => `Consultando ${a.stepKey}`,
  web_search: (a) => `Pesquisando: "${a.query}"`,
  create_task: (a) => `Criando task: ${a.title}`,
};

const TOOL_ICONS: Record<string, typeof Sparkles> = {
  set_field: Pencil,
  add_item: Plus,
  update_item: Pencil,
  delete_item: Trash2,
  get_step_data: Database,
  web_search: Search,
  create_task: ListTodo,
};

export function ToolCallCard({ toolName, args, state }: ToolCallCardProps) {
  const isRunning = state === "partial-call" || state === "call";
  const isDone = state === "result";

  const labelFn = TOOL_LABELS[toolName];
  const label = labelFn ? labelFn(args) : toolName;

  const Icon = TOOL_ICONS[toolName] || Sparkles;

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all ${
        isRunning
          ? "border-primary/20 bg-primary/[5%]"
          : isDone
            ? "border-border bg-muted/50"
            : "border-border"
      }`}
    >
      {isRunning ? (
        <Loader2 className="h-3 w-3 animate-spin text-primary" />
      ) : isDone ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : (
        <Icon className="h-3 w-3 text-muted-foreground" />
      )}
      <span className={isRunning ? "shimmer-text font-medium" : "text-muted-foreground"}>
        {label}
      </span>
    </div>
  );
}
