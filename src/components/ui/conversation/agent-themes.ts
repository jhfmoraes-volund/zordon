import { AlphaIcon } from "@/components/icons/alpha-icon";
import { VitorIcon } from "@/components/icons/vitor-icon";

export type AgentId = "alpha" | "vitor";

export type AgentTheme = {
  id: AgentId;
  label: string;
  icon: typeof AlphaIcon;
  /** Cor primária do agente (oklch wrappado, pronto pra usar em CSS). */
  accent: string;
  /** Componentes raw L C H — usados pra compor variantes (ex: `oklch(${accentRaw} / 0.3)`). */
  accentRaw: string;
  /** Background do tile do badge — tom escuro com cromaticidade do accent. */
  tileBgRaw: string;
  accentSoft: string;
  glow: string;
  emptyHint: string;
  collapseThreshold: number;
  planEventName: string;
  planStorageKey: string;
};

export const AGENT_THEMES: Record<AgentId, AgentTheme> = {
  alpha: {
    id: "alpha",
    label: "Alpha",
    icon: AlphaIcon,
    // Vermelho terracota — Alpha tem accent próprio (não usa --primary do tema, que é neutro).
    accent: "oklch(0.58 0.15 30)",
    accentRaw: "0.58 0.15 30",
    tileBgRaw: "0.16 0.06 30",
    accentSoft: "oklch(0.58 0.15 30 / 0.08)",
    glow: "0 0 14px -4px oklch(0.58 0.15 30 / 0.40)",
    emptyHint:
      "Pergunte sobre sprint, alocação, reuniões ou peça para criar tasks.",
    collapseThreshold: 2,
    planEventName: "chat:planmode:alpha",
    planStorageKey: "chat.planMode.alpha",
  },
  vitor: {
    id: "vitor",
    label: "Vitor",
    icon: VitorIcon,
    accent: "oklch(0.74 0.18 55)",
    accentRaw: "0.74 0.18 55",
    tileBgRaw: "0.16 0.06 55",
    accentSoft: "oklch(0.74 0.18 55 / 0.08)",
    glow: "0 0 14px -4px oklch(0.74 0.18 55 / 0.40)",
    emptyHint:
      "Posso preencher campos, criar cards, sugerir melhorias e analisar a sessão.",
    collapseThreshold: 3,
    planEventName: "chat:planmode:vitor",
    planStorageKey: "chat.planMode.vitor",
  },
};

export function getAgentTheme(agent: AgentId): AgentTheme {
  return AGENT_THEMES[agent];
}
