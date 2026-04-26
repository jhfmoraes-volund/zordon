import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import {
  ShellHeader,
  ShellHeaderTriggerGroup,
  PageTitleProvider,
} from "@/components/app-shell";
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
      {/* defaultOpen=false + hoverExpand: sidebar inicia colapsada (icon mode);
          ao passar mouse, expande visualmente sobre o main; click no
          SidebarTrigger fixa aberta (persiste como "open" state). */}
      <SidebarProvider defaultOpen={false} hoverExpand>
        <AppSidebar />
        <AlphaChatProvider>
          <PageTitleProvider>
            {/* Flex container pro reflow do Alpha panel: <main> + <AlphaChatPanel>
                como flex siblings. AlphaChatPanel anima w-0 → w-96 no desktop;
                no mobile renderiza Sheet (ignora a flex column). */}
            <div className="flex flex-1 min-w-0">
              <main className="flex-1 min-w-0 overflow-auto">
                <ShellHeader
                  left={<SidebarTrigger className="size-9" />}
                  right={
                    <ShellHeaderTriggerGroup>
                      {auth.isImpersonating && (
                        <span className="text-xs font-medium uppercase tracking-wider text-amber-500">
                          Impersonando · {auth.member?.name}
                        </span>
                      )}
                      <AlphaChatTrigger />
                    </ShellHeaderTriggerGroup>
                  }
                />
                <div className="px-3 py-4 sm:px-4 lg:p-6">{children}</div>
              </main>
              <AlphaChatPanel />
            </div>
          </PageTitleProvider>
        </AlphaChatProvider>
      </SidebarProvider>
    </AuthProvider>
  );
}
