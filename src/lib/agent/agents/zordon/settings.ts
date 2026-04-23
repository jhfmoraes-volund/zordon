import { SCOPES, COMPLEXITIES } from "@/lib/task-constants";
import type { SettingsSchema } from "../../settings-schema";

/**
 * Tools that can be toggled under "require_approval_for".
 * Keep in sync with assembleZordonTools in ./tools.ts.
 */
export const ZORDON_TOOL_NAMES = [
  "create_task",
  "assign_task",
  "update_task_status",
  "update_task_priority",
  "update_task_estimate",
  "move_task_to_sprint",
  "remove_task_from_sprint",
  "delete_task",
  "bulk_move_tasks",
  "split_task",
] as const;

export const ZORDON_SETTINGS: SettingsSchema = {
  ideal_fp_per_sprint: {
    type: "number",
    label: "FP ideal por sprint",
    description: "Alvo de Function Points por sprint. Zordon usa como referência ao compor e alertar.",
    category: "Planejamento",
    min: 0,
    max: 500,
    step: 5,
    unit: "FP",
  },
  sprint_length_days: {
    type: "number",
    label: "Duração padrão do sprint",
    description: "Quantos dias dura um sprint por padrão.",
    category: "Planejamento",
    min: 1,
    max: 60,
    step: 1,
    unit: "dias",
  },
  fp_overflow_threshold: {
    type: "number",
    label: "Threshold de overflow",
    description: "Fator de capacidade que dispara alerta. 1.1 = alerta quando o sprint passa de 110%.",
    category: "Alertas",
    min: 1,
    max: 2,
    step: 0.05,
  },
  min_fp_per_member: {
    type: "number",
    label: "FP mínimo por membro",
    description: "Abaixo desse valor, Zordon sinaliza subutilização.",
    category: "Alertas",
    min: 0,
    max: 100,
    step: 1,
    unit: "FP",
  },
  auto_assign_priority: {
    type: "enum",
    label: "Critério de atribuição automática",
    description: "Como Zordon prioriza ao sugerir atribuições.",
    category: "Comportamento",
    options: [
      { value: "urgency", label: "Urgência (prazo + prioridade)" },
      { value: "capacity", label: "Capacidade (quem tem mais FP livre)" },
      { value: "skill_match", label: "Match de skill (especialidade do membro)" },
    ],
  },
  require_approval_for: {
    type: "string_array",
    label: "Ferramentas que exigem confirmação",
    description: "Zordon perguntará antes de executar cada ferramenta nesta lista.",
    category: "Segurança",
    options: [...ZORDON_TOOL_NAMES],
  },
  fp_matrix: {
    type: "matrix",
    label: "Matriz de Function Points",
    description: "Valor de FP por combinação de scope × complexity. Usado em auto-cálculo ao criar/estimar tasks.",
    category: "Estimativa",
    rows: SCOPES,
    cols: COMPLEXITIES,
    min: 1,
    max: 100,
  },
};
