"use client";

/**
 * Superfície do app "Inovação" (Oportunidades) no dock de Apps do cliente.
 *
 * Padrão FinanceApp: o app busca os próprios dados (GET own data + Skeleton no
 * loading) e renderiza o widget já existente (OpportunitiesWidget), que tem
 * hook/API/promote próprios (use-opportunities). Embrulho, não reescrita.
 */

import { useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { OpportunitiesWidget } from "@/components/opportunities/opportunities-widget";
import type { OpportunityRow } from "@/lib/dal/opportunities";

export function OpportunitiesApp({ clientId }: { clientId: string }) {
  const [opportunities, setOpportunities] = useState<OpportunityRow[] | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${clientId}/opportunities`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled) {
          setOpportunities((json?.opportunities ?? []) as OpportunityRow[]);
        }
      })
      .catch(() => {
        if (!cancelled) setOpportunities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (opportunities === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  return (
    <OpportunitiesWidget
      clientId={clientId}
      initialOpportunities={opportunities}
    />
  );
}
