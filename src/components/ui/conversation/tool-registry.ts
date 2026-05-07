import {
  Database,
  ListTodo,
  type LucideIcon,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";

type ToolMeta = {
  label: (args: Record<string, unknown>) => string;
  icon: LucideIcon;
};

export const TOOL_REGISTRY: Record<string, ToolMeta> = {
  set_field: {
    label: (a) => `Preenchendo ${a.field} em ${a.stepKey}`,
    icon: Pencil,
  },
  add_item: {
    label: (a) => `Criando item em ${a.arrayKey} (${a.stepKey})`,
    icon: Plus,
  },
  update_item: {
    label: (a) => `Atualizando item em ${a.arrayKey} (${a.stepKey})`,
    icon: Pencil,
  },
  delete_item: {
    label: (a) => `Removendo item de ${a.arrayKey} (${a.stepKey})`,
    icon: Trash2,
  },
  get_step_data: {
    label: (a) => `Consultando ${a.stepKey}`,
    icon: Database,
  },
  web_search: {
    label: (a) => `Pesquisando: "${a.query}"`,
    icon: Search,
  },
  create_task: {
    label: (a) => `Criando task: ${a.title}`,
    icon: ListTodo,
  },
};

export function resolveToolMeta(
  toolName: string,
  args: Record<string, unknown>,
): { label: string; icon: LucideIcon } {
  const meta = TOOL_REGISTRY[toolName];
  if (!meta) return { label: toolName, icon: Sparkles };
  try {
    return { label: meta.label(args ?? {}), icon: meta.icon };
  } catch {
    return { label: toolName, icon: meta.icon };
  }
}
