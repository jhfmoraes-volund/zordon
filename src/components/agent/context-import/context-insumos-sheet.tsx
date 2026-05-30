"use client";

import { useState } from "react";
import { Plus, ChevronDown, Mic, FileSpreadsheet, GitBranch } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
  ResponsiveSheetFooter,
} from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ContextLinkList, { type ContextLinkItem } from "./context-link-list";
import { cn } from "@/lib/utils";
import type { Database } from "@/lib/supabase/database.types";

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
  onImportSpreadsheet?: () => void;
  onImportGitHub?: () => void;
  showWeight?: boolean;
  scopeLabel?: ScopeLabels;
  /** Conteúdo extra renderizado dentro da seção "Linkados", após a lista de transcripts. */
  linkedExtras?: React.ReactNode;
  /** Conteúdo extra renderizado após a seção "Pool". */
  poolExtras?: React.ReactNode;
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
  onImportSpreadsheet,
  onImportGitHub,
  showWeight = false,
  scopeLabel,
  linkedExtras,
  poolExtras,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("all");

  const labels = { ...DEFAULT_LABELS[scope], ...scopeLabel };

  const filterByKind = (
    items: ContextLinkItem[],
    kinds: Database["public"]["Enums"]["context_source_kind"][],
  ) => items.filter((item) => !item.kind || kinds.includes(item.kind));

  const linkedAll = linkedTranscripts;
  const linkedTranscriptsOnly = filterByKind(linkedTranscripts, ["transcript", "meeting"]);
  const linkedSpreadsheets = filterByKind(linkedTranscripts, [
    "spreadsheet_csv",
    "spreadsheet_gsheets",
  ]);
  const linkedGitHub = filterByKind(linkedTranscripts, [
    "github_repo",
    "github_pr",
    "github_issue",
  ]);

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

  const renderPoolSection = () => {
    if (!showPoolSection) return null;
    return (
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {labels.pool} ({poolTranscripts.length})
        </h3>
        {scope === "project" && (
          <p className="mb-2 text-[11px] text-muted-foreground">
            Insumos já usados em outros rituais deste projeto. Adicione com 1 clique — o material
            é compartilhado.
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
                    <p className="truncate font-medium">{item.title ?? "Transcript sem título"}</p>
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
    );
  };

  const renderImportSection = () => {
    const hasMultipleOptions = onImportSpreadsheet || onImportGitHub;

    return (
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Importar novo
        </h3>
        <p className="mb-2 text-[11px] text-muted-foreground">
          {hasMultipleOptions
            ? "Busca transcrições, planilhas ou repositórios do GitHub."
            : "Busca diretamente no Roam ou Granola."}
          {scope === "project" &&
            " O insumo fica disponível pro pool do projeto pra próximos rituais."}
        </p>

        {hasMultipleOptions ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "w-full justify-start gap-2",
                "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
                "h-9 px-4 py-2",
              )}
            >
              <Plus className="size-3.5" />
              Importar novo…
              <ChevronDown className="ml-auto size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[240px]">
              <DropdownMenuItem onClick={onImportNew} className="gap-2">
                <Mic className="size-3.5" />
                Transcrição (Roam/Granola)
              </DropdownMenuItem>
              {onImportSpreadsheet && (
                <DropdownMenuItem onClick={onImportSpreadsheet} className="gap-2">
                  <FileSpreadsheet className="size-3.5" />
                  Planilha (CSV/GSheets)
                </DropdownMenuItem>
              )}
              {onImportGitHub && (
                <DropdownMenuItem onClick={onImportGitHub} className="gap-2">
                  <GitBranch className="size-3.5" />
                  GitHub (Repo/PR/Issue)
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={onImportNew}
            className={cn("w-full justify-start gap-2")}
          >
            <Plus className="size-3.5" />
            Buscar reuniões pra importar…
          </Button>
        )}
      </section>
    );
  };

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>{title}</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="all">Tudo ({linkedAll.length})</TabsTrigger>
              <TabsTrigger value="transcripts">
                Transcripts ({linkedTranscriptsOnly.length})
              </TabsTrigger>
              <TabsTrigger value="spreadsheets">
                Planilhas ({linkedSpreadsheets.length})
              </TabsTrigger>
              <TabsTrigger value="github">GitHub ({linkedGitHub.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="space-y-6 mt-0">
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {labels.linked} ({linkedAll.length})
                </h3>
                <ContextLinkList
                  items={linkedAll}
                  onRemove={handleUnlink}
                  showWeight={showWeight}
                  emptyLabel={labels.empty ?? "Nenhum item linkado."}
                  busyId={busy}
                />
                {linkedExtras}
              </section>
              {renderPoolSection()}
              {poolExtras}
              {renderImportSection()}
            </TabsContent>

            <TabsContent value="transcripts" className="space-y-6 mt-0">
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Transcrições linkadas ({linkedTranscriptsOnly.length})
                </h3>
                <ContextLinkList
                  items={linkedTranscriptsOnly}
                  onRemove={handleUnlink}
                  showWeight={showWeight}
                  emptyLabel="Nenhuma transcrição linkada."
                  busyId={busy}
                />
              </section>
              {renderImportSection()}
            </TabsContent>

            <TabsContent value="spreadsheets" className="space-y-6 mt-0">
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Planilhas linkadas ({linkedSpreadsheets.length})
                </h3>
                <ContextLinkList
                  items={linkedSpreadsheets}
                  onRemove={handleUnlink}
                  showWeight={showWeight}
                  emptyLabel="Nenhuma planilha linkada."
                  busyId={busy}
                />
              </section>
              {renderImportSection()}
            </TabsContent>

            <TabsContent value="github" className="space-y-6 mt-0">
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  GitHub linkado ({linkedGitHub.length})
                </h3>
                <ContextLinkList
                  items={linkedGitHub}
                  onRemove={handleUnlink}
                  showWeight={showWeight}
                  emptyLabel="Nenhum item do GitHub linkado."
                  busyId={busy}
                />
              </section>
              {renderImportSection()}
            </TabsContent>
          </Tabs>
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
