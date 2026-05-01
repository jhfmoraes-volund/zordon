"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { usePageTitle } from "./page-title-context";

const STATIC_FALLBACKS: Record<string, string> = {
  "/": "Overview",
  "/projects": "Projetos",
  "/clients": "Clientes",
  "/meetings": "Reuniões",
  "/members": "Membros",
  "/squads": "Squads",
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
  meetings: "Reunião",
  clients: "Cliente",
  members: "Membro",
  squads: "Squad",
  "design-sessions": "Design Session",
  agents: "Agente",
};

function deriveFallback(pathname: string): string {
  if (STATIC_FALLBACKS[pathname]) return STATIC_FALLBACKS[pathname];

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
  const { title, subtitle, backHref } = usePageTitle();
  const displayTitle = title ?? deriveFallback(pathname);

  if (!displayTitle && !subtitle && !backHref) return null;

  return (
    <div className="flex min-w-0 items-center gap-1">
      {backHref && (
        <Link
          href={backHref}
          aria-label="Voltar"
          className="-ml-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
      )}
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
    </div>
  );
}
