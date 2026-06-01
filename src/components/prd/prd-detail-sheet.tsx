"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
} from "@/components/ui/responsive-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PrdDetail } from "@/components/prd/prd-detail";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import type { ProductRequirementRow } from "@/lib/dal/product-requirements";

type DetailBundle = {
  prd: ProductRequirementRow;
  project: { id: string; name: string };
  modules: { id: string; name: string }[];
  personas: { id: string; name: string }[];
  activity: {
    id: string;
    kind: string;
    actorAgent: string | null;
    actorName: string | null;
    createdAt: string;
  }[];
  canEdit: boolean;
};

type Props = {
  /** PRD to show. When null, the sheet is closed. */
  prdId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Bubbled up whenever the PRD changes (edit/approve) so lists can re-sync. */
  onChanged?: (prd: ProductRequirementRow) => void;
};

/**
 * In-session PRD detail — renders <PrdDetail> inside a ResponsiveSheet instead
 * of the (removed) standalone page. The full detail bundle (project, modules,
 * personas, activity) is fetched client-side from /api/prds/[id]/detail when the
 * sheet opens. Sheet nesting (edit sub-sheets) is handled by SheetDepthContext.
 */
export function PrdDetailSheet({ prdId, onOpenChange, onChanged }: Props) {
  const open = prdId !== null;
  const [bundle, setBundle] = useState<DetailBundle | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!prdId) {
        setBundle(null);
        return;
      }
      setLoading(true);
      setBundle(null);
      try {
        const res = await fetchOrThrow(`/api/prds/${prdId}/detail`);
        const data = (await res.json()) as DetailBundle;
        if (!cancelled) setBundle(data);
      } catch (err) {
        if (!cancelled) {
          showErrorToast(err, { label: "Carregar PRD" });
          onOpenChange(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prdId, onOpenChange]);

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="lg" className="overflow-y-auto">
        {loading || !bundle ? (
          <div className="flex flex-col gap-4 p-6">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="px-6">
            <PrdDetail
              prd={bundle.prd}
              project={bundle.project}
              modules={bundle.modules}
              personas={bundle.personas}
              activity={bundle.activity}
              canEdit={bundle.canEdit}
              onBack={() => onOpenChange(false)}
              onChanged={onChanged}
            />
          </div>
        )}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
