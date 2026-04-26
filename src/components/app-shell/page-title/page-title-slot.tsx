"use client";

import { usePathname } from "next/navigation";
import { usePageTitle } from "./page-title-context";

const STATIC_FALLBACKS: Record<string, string> = {
  "/": "Overview",
  "/projects": "Projetos",
  "/clients": "Clientes",
  "/sprints": "Sprints",
  "/meetings": "Reuniões",
  "/members": "Membros",
  "/squads": "Squads",
  "/design-sessions": "Design Sessions",
  "/agents": "Agentes",
  "/ops": "Alpha",
  "/profile": "Meu Perfil",
  "/profile/skills": "Skills",
  "/profile/pdi": "PDI",
  "/settings": "Configurações",
  "/workflow": "Workflow",
};

const ENTITY_LABEL: Record<string, string> = {
  projects: "Projeto",
  sprints: "Sprint",
  meetings: "Reunião",
  clients: "Cliente",
  members: "Membro",
  squads: "Squad",
  "design-sessions": "Design Session",
  agents: "Agente",
};

function deriveFallback(pathname: string): string {
  if (STATIC_FALLBACKS[pathname]) return STATIC_FALLBACKS[pathname];

  if (/^\/sprints\/[^/]+\/board$/.test(pathname)) return "Board do sprint";

  const entityMatch = pathname.match(/^\/([^/]+)\/[^/]+$/);
  if (entityMatch) {
    const entity = entityMatch[1];
    return ENTITY_LABEL[entity] || entity;
  }

  return "";
}

/**
 * Renders the title in the header. Reads from PageTitle context first, falls
 * back to a route-derived label so every page has at least a basic title.
 */
export function PageTitleSlot() {
  const pathname = usePathname();
  const { title, subtitle } = usePageTitle();
  const displayTitle = title ?? deriveFallback(pathname);

  if (!displayTitle && !subtitle) return null;

  return (
    <div className="min-w-0">
      {displayTitle && (
        <span className="block truncate text-sm font-semibold">
          {displayTitle}
        </span>
      )}
      {subtitle && (
        <span className="block truncate font-mono text-xs text-muted-foreground">
          {subtitle}
        </span>
      )}
    </div>
  );
}
