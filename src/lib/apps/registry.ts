/**
 * Zordon Apps — registry code-first (catálogo).
 *
 * Um "app" é um bundle nomeado de capacidades que incrementa o workspace do
 * projeto: superfície (sheet no tab Apps), ETL/endpoints existentes, projeção
 * de contexto (ContextSource kinds que emite) e/ou artefatos externos.
 *
 * O registry é só metadata — o dispatch de superfície vive em
 * src/app/(dashboard)/projects/[id]/_tabs/apps-tab.tsx. Instalação por
 * projeto (tabela ProjectApp) fica pra fase 2; por ora todo app `installed`
 * aparece em todos os projetos.
 */
import {
  CalendarClock,
  Flame,
  FolderOpen,
  Lightbulb,
  NotebookText,
  type LucideIcon,
} from "lucide-react";

export type AppWindowSize = "lg" | "xl" | "2xl" | "3xl";

export type AppDef = {
  key: string;
  name: string;
  /** Uma linha — tooltip do dock e subtítulo do card. */
  tagline: string;
  /** Corpo do card no canvas. */
  description: string;
  icon: LucideIcon;
  /**
   * Cor de identidade do app — classe de bg usada como dot (catálogo, chrome
   * da janela). Linguagem console: ícones monocromáticos, cor só pra
   * identidade/estado, nunca tile preenchido.
   */
  dot: string;
  /** Tamanho do ResponsiveSheet que hospeda a superfície. */
  window: AppWindowSize;
  /** O que o app alimenta no projeto (contrato: app = unidade de input de contexto). */
  produces: { context?: string[]; artifacts?: string[] };
  requires?: { composio?: string };
  minAccessLevel?: "manager" | "builder";
  /** installed = abre; available = visível no catálogo, ainda sem superfície. */
  status: "installed" | "available";
};

export const APP_REGISTRY: AppDef[] = [
  {
    key: "drive",
    name: "Google Drive",
    tagline: "Documentos do cliente, por etapa",
    description:
      "Espelha a pasta do projeto no Drive — Comercial, Imersão, Ops — e importa documentos pro pool de contexto dos agentes.",
    icon: FolderOpen,
    dot: "bg-emerald-500",
    window: "2xl",
    produces: { context: ["gdrive_file"] },
    requires: { composio: "googledrive" },
    status: "installed",
  },
  {
    key: "sessions",
    name: "Design Sessions",
    tagline: "Discovery estruturado com o Vitor",
    description:
      "Crie e conduza Design Sessions (Inception, CI) sem sair daqui — transcripts, decisões e PRDs alimentam o contexto do projeto.",
    icon: Lightbulb,
    dot: "bg-amber-500",
    window: "2xl",
    produces: { context: ["transcript"], artifacts: ["prd"] },
    status: "installed",
  },
  {
    key: "ceremonies",
    name: "Rituais",
    tagline: "Daily, Planning e PM Review",
    description:
      "Cerimônias do projeto com a Vitoria — cada ritual gera notas, decisões e plano de tasks que voltam pro contexto.",
    icon: CalendarClock,
    dot: "bg-violet-500",
    window: "2xl",
    produces: { context: ["meeting"] },
    status: "installed",
  },
  {
    key: "forge",
    name: "Forge",
    tagline: "Execução autônoma de PRDs",
    description:
      "PRDs prontos viram código: builders autônomos executam, e o resultado termina em git push no repo do cliente.",
    icon: Flame,
    dot: "bg-orange-500",
    window: "3xl",
    produces: { context: [], artifacts: ["git_push"] },
    minAccessLevel: "manager",
    status: "installed",
  },
  {
    key: "notion",
    name: "Notion",
    tagline: "Páginas e bases como contexto",
    description:
      "Importe páginas e databases do Notion pro pool de contexto — mesma simulação visual do Drive, com o workspace do cliente.",
    icon: NotebookText,
    dot: "bg-zinc-400",
    window: "2xl",
    produces: { context: ["notion"] },
    requires: { composio: "notion" },
    status: "available",
  },
];

export function getApp(key: string): AppDef | undefined {
  return APP_REGISTRY.find((a) => a.key === key);
}
