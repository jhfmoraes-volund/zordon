import Link from "next/link";
import { X } from "lucide-react";
import {
  AuthProvider,
  type AuthValue,
  type SessionMember,
} from "@/contexts/auth-context";
import {
  verifySession,
  getRealRole,
  getEffectiveRole,
  getCurrentMember,
} from "@/lib/dal";

/**
 * Focus layout — used by flows that need full attention (no sidebar,
 * minimal chrome). Currently the skills self-assessment wizard.
 * Auth is provided so client components can read the current member.
 */
export default async function FocusLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await verifySession();
  const realRole = await getRealRole();
  const effectiveRole = await getEffectiveRole();
  const member = await getCurrentMember();

  const members: SessionMember[] = [];

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
      <main className="flex-1 min-h-screen w-full bg-background">
        <header className="flex items-center justify-between border-b border-border/50 px-6 py-3">
          <Link href="/profile" className="text-sm font-semibold tracking-tight">
            Volund
          </Link>
          <Link
            href="/profile"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Sair do modo foco"
          >
            <X className="h-3.5 w-3.5" />
            Sair
          </Link>
        </header>
        {children}
      </main>
    </AuthProvider>
  );
}
