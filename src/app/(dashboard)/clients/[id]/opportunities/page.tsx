"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { OpportunitiesWidget } from "@/components/opportunities/opportunities-widget";
import type { OpportunityRow } from "@/lib/dal/opportunities";
import { useClientContext } from "../_context/client-context";

export default function OpportunitiesPage() {
  const { clientId } = useClientContext();
  const supabase = useMemo(() => createClient(), []);
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Table not in database.types.ts yet (OPP-005)
    const { data } = await supabase.from("Opportunity" as any)
      .select("*")
      .eq("clientId", clientId)
      .order("priorityRank", { ascending: true, nullsFirst: false })
      .order("createdAt", { ascending: false });
    // @ts-expect-error -- Table not in database.types.ts yet (OPP-005)
    setOpportunities((data ?? []) as OpportunityRow[]);
    setLoading(false);
  }, [clientId, supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional data loading pattern
    void load();
  }, [load]);

  if (loading) {
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
