"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, Plus } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
} from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import type { ChipTone } from "@/lib/status-chips";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { toast } from "sonner";

type AvailablePrd = {
  id: string;
  reference: string;
  title: string;
  status: string;
};

const PRD_STATUS_TONE: Record<string, ChipTone> = {
  approved: "green",
  review: "blue",
  draft: "muted",
  superseded: "muted",
};

interface Props {
  sessionId: string;
  sprintCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Disparado após vincular — o command center recarrega a session. */
  onLinked: () => void;
}

export function PrdPicker({ sessionId, sprintCount, open, onOpenChange, onLinked }: Props) {
  const [prds, setPrds] = useState<AvailablePrd[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/planning-sessions/${sessionId}/prds`);
      if (!r.ok) {
        setPrds([]);
        return;
      }
      const { prds: list } = (await r.json()) as { prds: AvailablePrd[] };
      setPrds(list ?? []);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: refetch da lista quando o picker abre
    if (open) void load();
  }, [open, load]);

  const handleLink = useCallback(
    async (prdId: string) => {
      setLinkingId(prdId);
      try {
        await fetchOrThrow(`/api/planning-sessions/${sessionId}/prds`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productRequirementId: prdId, sprintStart: 1 }),
        });
        setPrds((cur) => cur.filter((p) => p.id !== prdId));
        toast.success("PRD vinculado à sprint 1.");
        onLinked();
      } catch (err) {
        showErrorToast(err, { label: "Falha ao vincular PRD" });
      } finally {
        setLinkingId(null);
      }
    },
    [sessionId, onLinked],
  );

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Vincular PRD</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>
        <ResponsiveSheetBody>
          <p className="mb-3 text-xs text-muted-foreground">
            PRDs do projeto (aprovados/em revisão). Vincular adiciona à sprint 1 — arraste no
            board ou peça pra Vitoria reposicionar. Há {sprintCount} sprints disponíveis.
          </p>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : prds.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              <FileText className="mx-auto mb-2 size-6 opacity-50" />
              Nenhum PRD disponível pra vincular. Gere PRDs com o Vitor primeiro.
            </div>
          ) : (
            <ul className="space-y-2">
              {prds.map((prd) => (
                <li
                  key={prd.id}
                  className="flex items-center gap-3 rounded-md border bg-card px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {prd.reference}
                      </span>
                      <StatusChip tone={PRD_STATUS_TONE[prd.status] ?? "muted"}>
                        {prd.status}
                      </StatusChip>
                    </div>
                    <p className="truncate text-sm font-medium">{prd.title}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={linkingId === prd.id}
                    onClick={() => void handleLink(prd.id)}
                  >
                    {linkingId === prd.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Plus className="size-3.5" />
                    )}
                    Vincular
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
