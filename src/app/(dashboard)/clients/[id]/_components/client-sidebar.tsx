"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  Lightbulb,
  MessageSquareHeart,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SidebarItem = {
  segment: string;
  label: string;
  icon: LucideIcon;
};

const SECTIONS: SidebarItem[] = [
  { segment: "overview", label: "Geral", icon: LayoutDashboard },
  { segment: "projects", label: "Projetos", icon: FolderKanban },
  { segment: "opportunities", label: "Oportunidades", icon: Lightbulb },
  { segment: "csat", label: "CSAT", icon: MessageSquareHeart },
  { segment: "settings", label: "Configurações", icon: Settings },
];

type ClientSidebarProps = {
  clientId: string;
};

export function ClientSidebar({ clientId }: ClientSidebarProps) {
  const pathname = usePathname();
  const base = `/clients/${clientId}`;

  return (
    <nav className="md:sticky md:top-4 md:self-start">
      <ul className="flex gap-1 overflow-x-auto md:flex-col md:gap-0.5 md:overflow-visible">
        {SECTIONS.map((s) => {
          const href = `${base}/${s.segment}`;
          const isActive =
            pathname === href || pathname.startsWith(`${href}/`);
          const Icon = s.icon;
          return (
            <li key={s.segment} className="shrink-0">
              <Link
                href={href}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors whitespace-nowrap md:flex md:w-full",
                  isActive
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
