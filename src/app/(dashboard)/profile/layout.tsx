"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Pencil, Star, Target, User, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/app-shell";
import { useAuth } from "@/contexts/auth-context";
import { roleLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { ProfileEditDialog } from "@/components/profile/profile-edit-dialog";

const TABS = [
  { href: "/profile", label: "Visão geral", icon: User, exact: true },
  { href: "/profile/capacity", label: "Capacity", icon: Zap },
  { href: "/profile/pdi", label: "PDI", icon: Target },
  // Skills vive no route group (focus) — o link sai do shell do dashboard
  // de propósito (flow imersivo de auto-avaliação).
  { href: "/profile/skills", label: "Skills", icon: Star },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { member, effectiveAccessLevel } = useAuth();
  const [editOpen, setEditOpen] = useState(false);

  // Sem member vinculado, a page mostra o empty state — só centraliza.
  if (!member) return <PageContainer>{children}</PageContainer>;

  const isGuest = effectiveAccessLevel === "guest";

  return (
    <PageContainer>
      <div className="space-y-6">
        {/* Header compartilhado entre as subpáginas do perfil */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold tracking-wide text-primary">
              {initials(member.name)}
            </div>
            <div>
              <h1 className="text-2xl font-bold">{member.name}</h1>
              <p className="text-sm text-muted-foreground">
                {roleLabel(member.position)}
                {member.email ? ` · ${member.email}` : ""}
              </p>
            </div>
          </div>
          {!isGuest && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Editar perfil
            </Button>
          )}
        </div>

        {/* Tabs — mobile: só ícones, distribuídos, sem scroll. Desktop: ícone + label.
            Mesmo padrão da nav do projeto (projects/[id]/page.tsx). */}
        {!isGuest && (
          <nav className="-mx-3 flex border-b px-3 md:mx-0 md:gap-1 md:px-0">
            {TABS.map((tab) => {
              const isActive = tab.exact
                ? pathname === tab.href
                : pathname.startsWith(tab.href);
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-label={tab.label}
                  className={cn(
                    "flex flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 py-2.5 text-sm font-medium transition-colors md:flex-none md:justify-start md:px-4 md:py-2",
                    isActive
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-5 md:size-4" />
                  <span className="hidden md:inline">{tab.label}</span>
                </Link>
              );
            })}
          </nav>
        )}

        {children}
      </div>

      {!isGuest && (
        <ProfileEditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          member={member}
        />
      )}
    </PageContainer>
  );
}
