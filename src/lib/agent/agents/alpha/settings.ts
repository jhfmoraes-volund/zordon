import { SCOPES, COMPLEXITIES } from "@/lib/task-constants";
import type { SettingsSchema } from "../../settings-schema";

/**
 * Tools that can be toggled under "require_approval_for".
 * Keep in sync with assembleAlphaTools in ./tools.ts.
 */
export const ALPHA_TOOL_NAMES = [
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

export const ALPHA_SETTINGS: SettingsSchema = {
  sprint_length_days: {
    type: "number",
    label: "Duração padrão do sprint",
    description: "Quantos dias dura um sprint por padrão. Default semanal (7).",
    category: "Planejamento",
    min: 1,
    max: 60,
    step: 1,
    unit: "dias",
  },
  fp_overflow_threshold: {
    type: "number",
    label: "Threshold de overflow",
    description: "Fator aplicado sobre a capacidade real (soma de alocações dos membros). 1.1 = alerta acima de 110%.",
    category: "Alertas",
    min: 1,
    max: 2,
    step: 0.05,
  },
  min_utilization_percent: {
    type: "number",
    label: "Utilização mínima por membro",
    description: "Percentual mínimo da alocação que um membro deve estar usando. Abaixo disso vira alerta de subutilização. 0.5 = 50%.",
    category: "Alertas",
    min: 0,
    max: 1,
    step: 0.05,
  },
  auto_assign_priority: {
    type: "enum",
    label: "Critério de atribuição automática",
    description: "Como Alpha prioriza ao sugerir atribuições.",
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
    description: "Alpha perguntará antes de executar cada ferramenta nesta lista.",
    category: "Segurança",
    options: [...ALPHA_TOOL_NAMES],
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
