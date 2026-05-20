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
  BookOpen,
  CalendarCheck,
  User,
  LogOut,
  Settings,
  SlidersHorizontal,
  FlaskConical,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/auth-context";
import { setImpersonation } from "@/app/(dashboard)/_actions/impersonation";
import { hasMinLevel, ADMIN, roleLabel, hasMinAccessLevel } from "@/lib/roles";
import { NavItemPending } from "@/components/nav-item-pending";
import { InstallAppButton } from "@/components/install-app-button";

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

// Items shared by Builder and Manager — visibility of squads/members.
// Design Sessions são acessadas apenas dentro de cada projeto.
const sharedNav: NavItem[] = [
  { title: "Squads", href: "/squads", icon: Shield },
  { title: "Membros", href: "/members", icon: UserCog },
  // Builders entram com acesso read-only às meetings em que são attendees e
  // gerenciam suas próprias reuniões privadas + Notas Privadas.
  { title: "Reuniões", href: "/meetings", icon: CalendarCheck },
];

// Manager+ only (PM, head-ops, CEO).
// Nota: "Alpha" foi removido do sidebar — Alpha é acessível pelo botão Bot
// no header em qualquer página. Página /ops continua existindo (acesso via
// botão "Histórico" dentro do panel do Alpha).
const managerOnlyNav: NavItem[] = [
  { title: "Overview", href: "/", icon: LayoutDashboard },
];

// Manager+ (PM, head-ops, CEO) — tuning de agentes.
const agentsTuningNav: NavItem[] = [
  { title: "Agentes", href: "/agents", icon: SlidersHorizontal },
];

// Manager+ (PM, head-ops, CEO) — sandbox de UI / mocks de schema.
const managerSandboxNav: NavItem[] = [
  { title: "Sandbox", href: "/dev", icon: FlaskConical },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { isMobile, setOpenMobile } = useSidebar();
  const {
    realRole,
    realAccessLevel,
    effectiveAccessLevel,
    member,
    members,
    isImpersonating,
    userEmail,
  } = useAuth();

  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  // Real admin: can impersonate (dropdown).
  // Manager (incl. admins and PMs; via effective access level): can see the
  // Gestão menu e tunar agentes.
  const canImpersonate =
    hasMinAccessLevel(realAccessLevel, "admin") || hasMinLevel(realRole, ADMIN);
  const canTuneAgents = hasMinAccessLevel(effectiveAccessLevel, "manager");
  const canSeeManagement = hasMinAccessLevel(effectiveAccessLevel, "manager");
  // Guests only see project navigation. Hide personal/settings/management.
  const isGuest = !hasMinAccessLevel(effectiveAccessLevel, "builder");

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
    <Sidebar
      collapsible="icon"
      className="md:!top-14 md:!h-[calc(100svh-3.5rem)]"
    >
      <SidebarContent>
        {!isGuest && (
          <>
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname === "/profile"}
                    render={<Link href="/profile" />}
                    tooltip="Meu Perfil"
                    onClick={closeOnMobile}
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
                    tooltip="Configuracoes"
                    onClick={closeOnMobile}
                  >
                    <Settings className="h-4 w-4" />
                    <span>Configuracoes</span>
                    <NavItemPending />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>

            <SidebarSeparator className="my-1" />
          </>
        )}

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 px-5 group-data-[collapsible=icon]:!mt-0">
            Projetos
          </SidebarGroupLabel>
          <SidebarMenu>
            {projectNav.map((item) => {
              // /design-sessions vive dentro do contexto de Projetos: highlight
              // o item "Projetos" também quando o usuário está numa sessão.
              const isActive =
                pathname.startsWith(item.href) ||
                (item.href === "/projects" &&
                  pathname.startsWith("/design-sessions"));
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive}
                    render={<Link href={item.href} />}
                    tooltip={item.title}
                    onClick={closeOnMobile}
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

        <SidebarSeparator className="my-1" />

        {!isGuest && (
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/70 px-5 group-data-[collapsible=icon]:!mt-0">
            Gestão
          </SidebarGroupLabel>
          <SidebarMenu>
            {[
              ...(canSeeManagement ? managerOnlyNav : []),
              ...sharedNav,
              ...(canTuneAgents ? agentsTuningNav : []),
              ...(canSeeManagement ? managerSandboxNav : []),
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
                    tooltip={item.title}
                    onClick={closeOnMobile}
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
        )}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3 group-data-[collapsible=icon]:p-2">
        <div className="space-y-2">
          {/* Install PWA button — hidden when already installed or unsupported */}
          <div className="group-data-[collapsible=icon]:hidden">
            <InstallAppButton />
          </div>

          {/* Current user info — hidden when sidebar is collapsed to icon rail */}
          <div className="px-2 py-1 group-data-[collapsible=icon]:hidden">
            <p className="text-xs font-medium truncate">
              {member?.name ?? "Sem membro vinculado"}
            </p>
            <p className="text-[10px] text-muted-foreground truncate">
              {userEmail ?? "—"}
              {member && (
                <span className="ml-1">· {roleLabel(member.position)}</span>
              )}
            </p>
          </div>

          {/* Admin-only impersonation dropdown — needs width, hidden when collapsed */}
          {canImpersonate && members.length > 0 && (
            <div className="group-data-[collapsible=icon]:hidden">
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
                        ({roleLabel(m.position)})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <form action="/auth/signout" method="post">
            <SidebarMenuButton
              type="submit"
              className="w-full text-muted-foreground hover:text-foreground"
              tooltip="Sair"
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
