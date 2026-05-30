"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
  ResponsiveSheetFooter,
} from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import ContextLinkList, { type ContextLinkItem } from "./context-link-list";
import { cn } from "@/lib/utils";

export type ScopeLabels = {
  linked?: string;
  pool?: string;
  empty?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  scope: "session" | "project";
  linkedTranscripts: ContextLinkItem[];
  poolTranscripts: ContextLinkItem[];
  onLink: (transcriptRefId: string) => Promise<void>;
  onUnlink: (transcriptRefId: string) => Promise<void>;
  onImportNew: () => void;
  showWeight?: boolean;
  scopeLabel?: ScopeLabels;
};

const DEFAULT_LABELS: Record<Props["scope"], ScopeLabels> = {
  session: {
    linked: "Insumos desta sessão",
    pool: "Pool disponível",
    empty: "Nada linkado ainda. Importe novo abaixo.",
  },
  project: {
    linked: "Insumos deste item",
    pool: "Pool do projeto",
    empty: "Nada linkado ainda. Use o pool abaixo ou importe novo.",
  },
};

export default function ContextInsumosSheet({
  open,
  onOpenChange,
  title,
  scope,
  linkedTranscripts,
  poolTranscripts,
  onLink,
  onUnlink,
  onImportNew,
  showWeight = false,
  scopeLabel,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  const labels = { ...DEFAULT_LABELS[scope], ...scopeLabel };

  const showPoolSection = !(scope === "session" && poolTranscripts.length === 0);

  async function handleLink(transcriptRefId: string) {
    setBusy(transcriptRefId);
    try {
      await onLink(transcriptRefId);
    } finally {
      setBusy(null);
    }
  }

  async function handleUnlink(transcriptRefId: string) {
    setBusy(transcriptRefId);
    try {
      await onUnlink(transcriptRefId);
    } finally {
      setBusy(null);
    }
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>{title}</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          <div className="space-y-6">
            {/* Section 1 — Linkados */}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {labels.linked} ({linkedTranscripts.length})
              </h3>
              <ContextLinkList
                items={linkedTranscripts}
                onRemove={handleUnlink}
                showWeight={showWeight}
                emptyLabel={labels.empty ?? "Nenhum item linkado."}
                busyId={busy}
              />
            </section>

            {/* Section 2 — Pool (conditional) */}
            {showPoolSection && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {labels.pool} ({poolTranscripts.length})
                </h3>
                {scope === "project" && (
                  <p className="mb-2 text-[11px] text-muted-foreground">
                    Insumos já usados em outros rituais deste projeto. Adicione com
                    1 clique — o material é compartilhado.
                  </p>
                )}
                {poolTranscripts.length === 0 ? (
                  <p className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
                    Pool vazio.
                    {scope === "project" &&
                      " Este é o primeiro ritual a curar insumos no projeto — importe novo abaixo."}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {poolTranscripts.map((item) => {
                      const isBusy = busy === item.id;
                      return (
                        <li
                          key={item.id}
                          className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">
                              {item.title ?? "Transcript sem título"}
                            </p>
                            <p className="truncate text-[10px] text-muted-foreground">
                              {item.source}
                              {item.capturedAt && ` · ${item.capturedAt}`}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 gap-1 px-2 text-[10px]"
                            onClick={() => handleLink(item.id)}
                            disabled={isBusy}
                          >
                            <Plus className="size-3" /> adicionar
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            {/* Section 3 — Importar novo */}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Importar novo (Roam / Granola)
              </h3>
              <p className="mb-2 text-[11px] text-muted-foreground">
                Busca diretamente no Roam ou Granola.
                {scope === "project" &&
                  " O transcript fica disponível pro pool do projeto pra próximos rituais."}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={onImportNew}
                className={cn("w-full justify-start gap-2")}
              >
                <Plus className="size-3.5" />
                Buscar reuniões pra importar…
              </Button>
            </section>
          </div>
        </ResponsiveSheetBody>

        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
