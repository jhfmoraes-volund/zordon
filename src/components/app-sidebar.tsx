"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  Users,
  FolderKanban,
  Shield,
  UserCog,
  LayoutDashboard,
  Lightbulb,
  ListTodo,
  BookOpen,
  CalendarCheck,
  User,
  LogOut,
  Settings,
  Bot,
  SlidersHorizontal,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { VolundLogo } from "@/components/volund-logo";
import { useAuth } from "@/contexts/auth-context";
import { setImpersonation } from "@/app/(dashboard)/_actions/impersonation";
import { hasMinLevel, MANAGER, ADMIN, roleLabel } from "@/lib/roles";
import { NavItemPending } from "@/components/nav-item-pending";

type NavItem = {
  title: string;
  href: string;
  icon: typeof LayoutDashboard;
};

const projectNav: NavItem[] = [
  { title: "Projetos", href: "/projects", icon: FolderKanban },
  { title: "Clientes", href: "/clients", icon: Users },
  { title: "Workflow", href: "/workflow", icon: BookOpen },
];

// Items shared by Builder and Manager — full access to sessions/tasks,
// visibility of squads/members. RLS + API guards restrict what Builder can
// actually mutate (projetos alocados apenas).
const sharedNav: NavItem[] = [
  { title: "Design Sessions", href: "/design-sessions", icon: Lightbulb },
  { title: "Tasks", href: "/tasks", icon: ListTodo },
  { title: "Squads", href: "/squads", icon: Shield },
  { title: "Membros", href: "/members", icon: UserCog },
];

// Manager+ only (PM, head-ops, CEO).
const managerOnlyNav: NavItem[] = [
  { title: "Overview", href: "/", icon: LayoutDashboard },
  { title: "Zordon", href: "/ops", icon: Bot },
  { title: "Reuniões", href: "/meetings", icon: CalendarCheck },
];

// Admin only (head-ops, CEO) — tuning de agentes.
const adminOnlyNav: NavItem[] = [
  { title: "Agentes", href: "/agents", icon: SlidersHorizontal },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const {
    realRole,
    effectiveRole,
    member,
    members,
    isImpersonating,
    userEmail,
  } = useAuth();

  // Real admin: can impersonate (dropdown) and tune agents.
  // Manager (incl. admins and PMs; via effective role): can see the Gestão menu.
  const canImpersonate = hasMinLevel(realRole, ADMIN);
  const canTuneAgents = hasMinLevel(effectiveRole, ADMIN);
  const canSeeManagement = hasMinLevel(effectiveRole, MANAGER);

  const handleImpersonationChange = (memberId: string | null) => {
    if (!memberId) return;
    startTransition(async () => {
      // "self" sentinel = stop impersonating
      const target = memberId === "__self__" ? null : memberId;
      await setImpersonation(target);
      router.refresh();
    });
  };

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
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname === "/profile"}
                render={<Link href="/profile" />}
              >
                <User className="h-4 w-4" />
                <span>Meu Perfil</span>
                <NavItemPending />
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname === "/settings"}
                render={<Link href="/settings" />}
              >
                <Settings className="h-4 w-4" />
                <span>Configuracoes</span>
                <NavItemPending />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 px-5">
            Projetos
          </SidebarGroupLabel>
          <SidebarMenu>
            {projectNav.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive}
                    render={<Link href={item.href} />}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.title}</span>
                    <NavItemPending />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 px-5">
            Gestão
          </SidebarGroupLabel>
          <SidebarMenu>
            {[
              ...(canSeeManagement ? managerOnlyNav : []),
              ...sharedNav,
              ...(canTuneAgents ? adminOnlyNav : []),
            ].map((item) => {
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
                    <NavItemPending />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="space-y-2">
          {/* Current user info */}
          <div className="px-2 py-1">
            <p className="text-xs font-medium truncate">
              {member?.name ?? "Sem membro vinculado"}
            </p>
            <p className="text-[10px] text-muted-foreground truncate">
              {userEmail ?? "—"}
              {member && (
                <span className="ml-1">· {roleLabel(member.role)}</span>
              )}
            </p>
          </div>

          {/* Admin-only impersonation dropdown */}
          {canImpersonate && members.length > 0 && (
            <Select
              value={isImpersonating ? member?.id ?? "" : "__self__"}
              onValueChange={handleImpersonationChange}
              disabled={pending}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue>
                  {(value: string | null) => {
                    if (!value || value === "__self__") return "Ver como eu";
                    const m = members.find((m) => m.id === value);
                    return m
                      ? `Ver como ${m.name}`
                      : "Ver como…";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__self__">Ver como eu</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                    <span className="text-muted-foreground ml-1 text-xs">
                      ({roleLabel(m.role)})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <form action="/auth/signout" method="post">
            <SidebarMenuButton
              type="submit"
              className="w-full text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              <span>Sair</span>
            </SidebarMenuButton>
          </form>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
