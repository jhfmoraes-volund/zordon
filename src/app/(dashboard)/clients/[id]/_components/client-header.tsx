"use client";

import Link from "next/link";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClientContext } from "../_context/client-context";
import { ClientLogo } from "./client-logo";

export function ClientHeader() {
  const { client, loading } = useClientContext();

  return (
    <header className="flex items-start gap-3">
      <Link href="/clients">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Voltar"
        >
          <ArrowLeft className="size-4" />
        </Button>
      </Link>

      {loading || !client ? (
        <>
          <Skeleton className="size-12 shrink-0 rounded-lg" />
          <div className="space-y-1 min-w-0 flex-1">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </>
      ) : (
        <>
          <ClientLogo
            name={client.name}
            logoStoragePath={client.logoStoragePath}
            logoUpdatedAt={client.logoUpdatedAt}
            size="md"
          />
          <div className="space-y-1 min-w-0 flex-1">
            <h1 className="text-2xl font-bold truncate">{client.name}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {client.email ? (
                <a
                  href={`mailto:${client.email}`}
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <Mail className="h-3.5 w-3.5" />
                  {client.email}
                </a>
              ) : null}
              {client.phone ? (
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" />
                  {client.phone}
                </span>
              ) : null}
              {!client.email && !client.phone ? (
                <span className="italic">Sem contato cadastrado</span>
              ) : null}
            </div>
          </div>
        </>
      )}
    </header>
  );
}
