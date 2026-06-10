import {
  Users,
  Link2,
  Target,
  Crosshair,
  FileText,
  Server,
  KeyRound,
} from "lucide-react";

export const SECTION_ORDER = [
  "description",
  "links",
  "sponsors",
  "objectives",
  "success_indicators",
  "environments",
  "access",
];

export const SECTION_TITLES: Record<string, string> = {
  description: "Descrição do Projeto",
  links: "Links Rápidos",
  sponsors: "Sponsors",
  success_indicators: "KPIs / Métricas",
  objectives: "Objetivos",
  environments: "Ambientes",
  access: "Acessos",
};

export const sectionIcons: Record<string, typeof Users> = {
  description: FileText,
  sponsors: Users,
  links: Link2,
  success_indicators: Target,
  objectives: Crosshair,
  environments: Server,
  access: KeyRound,
};

export const indicatorStatusConfig: Record<
  string,
  { label: string; color: string }
> = {
  on_track: { label: "No caminho", color: "bg-green-100 text-green-800" },
  attention: { label: "Atenção", color: "bg-yellow-100 text-yellow-800" },
  at_risk: { label: "Em risco", color: "bg-red-100 text-red-800" },
};

export const linkCategories = ["geral", "design", "gestão", "técnico", "documentação"];
export const envTypes = ["development", "staging", "production", "sandbox"];
