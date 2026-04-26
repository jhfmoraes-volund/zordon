import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import {
  AuthProvider,
  type AuthValue,
  type SessionMember,
} from "@/contexts/auth-context";
import {
  AlphaChatProvider,
  AlphaChatTrigger,
  AlphaChatPanel,
} from "@/components/alpha-chat";
import {
  verifySession,
  getRealRole,
  getEffectiveRole,
  getCurrentMember,
} from "@/lib/dal";
import { hasMinLevel, ADMIN } from "@/lib/roles";
import { db } from "@/lib/db";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await verifySession();
  const realRole = await getRealRole();
  const effectiveRole = await getEffectiveRole();
  const member = await getCurrentMember();

  // Only fetch the full members list for admins (powers the impersonation dropdown).
  const isAdmin = hasMinLevel(realRole, ADMIN);
  const members: SessionMember[] = isAdmin
    ? (
        await db()
          .from("Member")
          .select("id, name, role, fpCapacity, email")
          .order("name")
      ).data ?? []
    : [];

  const auth: AuthValue = {
    userId: user.id,
    userEmail: user.email ?? null,
    realRole,
    effectiveRole,
    member: member
      ? {
          id: member.id,
          name: member.name,
          role: member.role,
          fpCapacity: member.fpCapacity,
          email: member.email,
        }
      : null,
    isImpersonating: !!member?._impersonatedBy,
    members,
  };

  return (
    <AuthProvider value={auth}>
      <SidebarProvider>
        <AppSidebar />
        <AlphaChatProvider>
          <main className="flex-1 overflow-auto">
            <div className="sticky top-0 z-40 flex items-center gap-2 border-b border-border/50 bg-background/80 px-6 py-3 pt-[max(env(safe-area-inset-top),0.75rem)] backdrop-blur md:static md:bg-transparent md:backdrop-blur-none">
              <SidebarTrigger className="h-10 w-10" />
              {auth.isImpersonating && (
                <span className="text-xs text-amber-500 font-medium uppercase tracking-wider">
                  Impersonando · {auth.member?.name}
                </span>
              )}
              <div className="ml-auto md:hidden">
                <AlphaChatTrigger variant="header" />
              </div>
            </div>
            <div className="px-3 py-4 sm:px-4 lg:p-6">{children}</div>
          </main>
          <div className="hidden md:block">
            <AlphaChatTrigger variant="floating" />
          </div>
          <AlphaChatPanel />
        </AlphaChatProvider>
      </SidebarProvider>
    </AuthProvider>
  );
}
