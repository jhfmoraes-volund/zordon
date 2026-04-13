"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users,
  FolderKanban,
  Shield,
  UserCog,
  Bot,
  LayoutDashboard,
  Lightbulb,
  ListTodo,
  BookOpen,
  CalendarCheck,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { VolundLogo } from "@/components/volund-logo";

const navItems = [
  { title: "Overview", href: "/", icon: LayoutDashboard },
  { title: "Clientes", href: "/clients", icon: Users },
  { title: "Projetos", href: "/projects", icon: FolderKanban },
  { title: "Tasks", href: "/tasks", icon: ListTodo },
  { title: "Squads", href: "/squads", icon: Shield },
  { title: "Membros", href: "/members", icon: UserCog },
  { title: "Reuniões", href: "/meetings", icon: CalendarCheck },
  { title: "Agentes", href: "/agents", icon: Bot },
  { title: "Design Sessions", href: "/design-sessions", icon: Lightbulb },
  { title: "Workflow", href: "/workflow", icon: BookOpen },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-5 py-4">
        <Link href="/" className="flex items-center gap-3">
          <VolundLogo className="h-4 w-auto" color="currentColor" />
        </Link>
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground mt-1">
          Zordon
        </p>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 px-5">
            Menu
          </SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive}
                    render={<Link href={item.href} />}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
