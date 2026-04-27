import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
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
  AlphaHistorySheet,
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

  // Membros recém-convidados (onboardedAt nulo) passam pelo flow inicial
  // antes de acessar qualquer rota do dashboard. Admins impersonando ficam
  // de fora do gate — caso contrário não dariam pra debugar contas novas.
  if (member && !member.onboardedAt && !member._impersonatedBy) {
    redirect("/onboarding");
  }

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
      {/* App-shell bounded ao viewport (padrão Linear/Cursor/Notion):
          - flex-col: ShellHeader full-width no topo, row sidebar+main+alpha
            embaixo. Borda do header não quebra no canto (estilo Supabase).
          - h-svh: trava o wrapper na viewport. Sem isso, <main overflow-auto>
            não tem teto e o body inteiro scrolla — header e alpha-panel
            "passeiam" junto. Com h-svh, só o <main> scrolla; header e alpha
            são flex-items naturais que ficam fixos por construção.
          - defaultOpen=false + hoverExpand: sidebar inicia colapsada (icon
            mode); hover expande visualmente sobre o main; click no
            SidebarTrigger fixa aberta (persiste como "open" state). */}
      <SidebarProvider
        className="flex-col h-svh"
        defaultOpen={false}
        hoverExpand
      >
        <AlphaChatProvider>
          <PageTitleProvider>
            <ShellHeader
              left={
                <>
                  {/* Célula da logo encostada no canto esquerdo, mesma largura
                      do sidebar collapsed (--sidebar-width-icon = 3rem) — assim
                      a borda direita da célula alinha com a borda direita do
                      sidebar de baixo. -ml-3/-ml-4 cancela o px do header pra
                      colar na ponta. */}
                  <Link
                    href="/"
                    aria-label="Volund"
                    className="-ml-3 flex h-12 w-(--sidebar-width-icon) items-center justify-center border-r border-border md:-ml-4 md:h-14"
                  >
                    <Image
                      src="/volund-logo-V.png"
                      alt=""
                      width={24}
                      height={24}
                      className="size-6 [mask-image:radial-gradient(circle,black_35%,transparent_95%)] [-webkit-mask-image:radial-gradient(circle,black_35%,transparent_95%)]"
                      priority
                    />
                  </Link>
                  <SidebarTrigger className="hidden size-9 md:inline-flex" />
                </>
              }
              right={
                <ShellHeaderTriggerGroup>
                  {auth.isImpersonating && (
                    <span className="text-xs font-medium uppercase tracking-wider text-amber-500">
                      Impersonando · {auth.member?.name}
                    </span>
                  )}
                  <SidebarTrigger className="size-9 md:hidden" />
                  <AlphaChatTrigger />
                </ShellHeaderTriggerGroup>
              }
            />
            <div className="flex flex-1 min-h-0 w-full">
              <AppSidebar />
              <main className="flex-1 min-w-0 overflow-auto">
                <div className="px-3 py-4 sm:px-4 lg:p-6">{children}</div>
              </main>
              <AlphaChatPanel />
            </div>
            {/* History sheet renderizado fora da arvore do AlphaChatPanel
                pra evitar conflito de focus-trap entre dois Base UI Dialogs
                irmaos. State e ações vivem no AlphaChatProvider. */}
            <AlphaHistorySheet />
          </PageTitleProvider>
        </AlphaChatProvider>
      </SidebarProvider>
    </AuthProvider>
  );
}
