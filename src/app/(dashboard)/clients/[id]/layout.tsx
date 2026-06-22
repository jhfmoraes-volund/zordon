"use client";

import Link from "next/link";
import { use } from "react";
import { ArrowLeft } from "lucide-react";
import { PageContainer } from "@/components/app-shell";
import { ClientProvider, useClientContext } from "./_context/client-context";
import { ClientHeader } from "./_components/client-header";
import { ClientSidebar } from "./_components/client-sidebar";

type LayoutProps = {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
};

export default function ClientDetailLayout({ params, children }: LayoutProps) {
  const { id } = use(params);

  return (
    <PageContainer>
      <ClientProvider clientId={id}>
        <ClientLayoutShell>{children}</ClientLayoutShell>
      </ClientProvider>
    </PageContainer>
  );
}

function ClientLayoutShell({ children }: { children: React.ReactNode }) {
  const { notFound } = useClientContext();

  if (notFound) {
    return (
      <div className="space-y-4">
        <Link
          href="/clients"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Clientes
        </Link>
        <div className="surface p-8 text-center text-sm text-muted-foreground">
          Cliente não encontrado.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ClientHeader />
      <ClientNavSlot />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ClientNavSlot() {
  const { clientId } = useClientContext();
  return <ClientSidebar clientId={clientId} />;
}
