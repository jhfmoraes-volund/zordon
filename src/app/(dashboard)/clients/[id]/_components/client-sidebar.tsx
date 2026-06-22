"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  LayoutGrid,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  segment: string;
  label: string;
  icon: LucideIcon;
};

// Espinha do cliente: Geral + Projetos. Tudo o mais (Oportunidades, CSAT) vive
// no dock do tab "Apps" (deep-link ?app=). Espelha a página de projeto.
const SECTIONS: NavItem[] = [
  { segment: "overview", label: "Geral", icon: LayoutDashboard },
  { segment: "projects", label: "Projetos", icon: FolderKanban },
  { segment: "apps", label: "Apps", icon: LayoutGrid },
  { segment: "settings", label: "Configurações", icon: Settings },
];

type ClientSidebarProps = {
  clientId: string;
};

/**
 * Nav horizontal underline (estilo Overview/página de projeto): ícone-only no
 * mobile, ícone + label no desktop. Ativo via segmento da rota.
 */
export function ClientSidebar({ clientId }: ClientSidebarProps) {
  const pathname = usePathname();
  const base = `/clients/${clientId}`;

  return (
    <nav className="flex border-b border-border md:gap-1">
      {SECTIONS.map((s) => {
        const href = `${base}/${s.segment}`;
        const isActive = pathname === href || pathname.startsWith(`${href}/`);
        const Icon = s.icon;
        return (
          <Link
            key={s.segment}
            href={href}
            aria-label={s.label}
            className={cn(
              "flex flex-1 shrink-0 items-center justify-center gap-1.5 border-b-2 py-2.5 text-sm font-medium transition-colors whitespace-nowrap md:flex-none md:justify-start md:px-4 md:py-2",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-5 md:size-4" />
            <span className="hidden md:inline">{s.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
