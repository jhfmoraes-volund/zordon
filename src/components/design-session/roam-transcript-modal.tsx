"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mic, AlertTriangle, RefreshCw, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Database } from "@/lib/supabase/database.types";
import type { RoamTranscriptListItem } from "@/lib/roam";

export type ImportedTranscript =
  Database["public"]["Tables"]["DesignSessionTranscript"]["Row"];

type AvailableTranscript = RoamTranscriptListItem & {
  alreadyImported: boolean;
};

type ApiResponse = {
  needsAuth: boolean;
  available: AvailableTranscript[];
  imported: ImportedTranscript[];
  error?: string;
};

const fmtDateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function durationMin(start: string, end: string): number {
  return Math.max(
    1,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000),
  );
}

export function RoamTranscriptModal({
  sessionId,
  open,
  onOpenChange,
  onImported,
}: {
  sessionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (t: ImportedTranscript) => void;
}) {
  const isMobile = useIsMobile();
  const router = useRouter();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRoamId, setSelectedRoamId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/design-sessions/${sessionId}/roam-transcripts`,
      );
      if (!res.ok) {
        setLoadError(`HTTP ${res.status}`);
        return;
      }
      const json = (await res.json()) as ApiResponse;
      setData(json);
    } catch (err) {
      setLoadError((err as Error).message || "Erro de rede");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSelectedRoamId(null);
    setImportError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId]);

  const handleImport = async () => {
    if (!selectedRoamId) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch(
        `/api/design-sessions/${sessionId}/roam-transcripts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roamTranscriptId: selectedRoamId }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setImportError(json.error || `HTTP ${res.status}`);
        return;
      }
      onImported(json as ImportedTranscript);
      onOpenChange(false);
    } catch (err) {
      setImportError((err as Error).message || "Erro de rede");
    } finally {
      setImporting(false);
    }
  };

  const showAuthCta = !!(
    data?.needsAuth ||
    (data?.error && data.available.length === 0)
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile ? "max-h-[90vh] rounded-t-xl" : "w-full sm:max-w-xl",
        )}
      >
        {isMobile && (
          <div
            aria-hidden="true"
            className="mx-auto mt-2 mb-1 h-1.5 w-12 shrink-0 rounded-full bg-muted"
          />
        )}

        <div className="shrink-0 border-b px-4 py-4 sm:px-6 sm:py-5">
          <SheetTitle className="flex items-center gap-2">
            <Mic className="h-4 w-4" />
            Importar reuniao do Roam
          </SheetTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Vitor vai usar a transcricao como contexto da sessao.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Carregando reunioes...</span>
            </div>
          )}

          {loadError && !loading && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <div className="flex items-center gap-2 text-destructive font-medium mb-2">
                <AlertTriangle className="h-4 w-4" />
                Falha ao carregar
              </div>
              <p className="text-muted-foreground mb-3">{loadError}</p>
              <Button size="sm" variant="outline" onClick={load}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Tentar novamente
              </Button>
            </div>
          )}

          {!loading && !loadError && data && showAuthCta && (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm">
              <p className="font-medium mb-1">Conecte sua conta Roam</p>
              <p className="text-muted-foreground mb-3">
                {data.error ??
                  "Voce ainda nao conectou seu token do Roam. Conecte para listar suas reunioes."}
              </p>
              <Button
                size="sm"
                onClick={() => router.push("/settings/integrations")}
              >
                Ir para integracoes
              </Button>
            </div>
          )}

          {!loading && !loadError && data && !showAuthCta && (
            <>
              {data.error && (
                <div className="rounded-lg border border-amber-300/40 bg-amber-50/40 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200">
                  {data.error}
                </div>
              )}

              {data.available.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Nenhuma reuniao recente encontrada no Roam.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.available.map((t) => {
                    const isSelected = selectedRoamId === t.id;
                    const disabled = t.alreadyImported;
                    const dur = durationMin(t.start, t.end);
                    const people = t.participants
                      .map((p) => p.name)
                      .filter(Boolean);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => setSelectedRoamId(t.id)}
                        className={cn(
                          "w-full text-left rounded-lg border p-3 transition-colors",
                          disabled
                            ? "opacity-50 cursor-not-allowed bg-muted/30"
                            : isSelected
                              ? "border-primary bg-primary/5"
                              : "hover:border-primary/40 hover:bg-muted/30",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate">
                              {t.eventName?.trim() || "Reuniao sem titulo"}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {fmtDateTime.format(new Date(t.start))} ·{" "}
                              {dur} min · {people.length}{" "}
                              {people.length === 1 ? "pessoa" : "pessoas"}
                            </p>
                            {people.length > 0 && (
                              <p className="text-xs text-muted-foreground mt-1 truncate">
                                {people.join(", ")}
                              </p>
                            )}
                          </div>
                          {disabled && (
                            <Badge variant="secondary" className="shrink-0 gap-1">
                              <Check className="h-3 w-3" /> Importada
                            </Badge>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {importError && (
            <p className="text-sm text-destructive">{importError}</p>
          )}
        </div>

        <div className="shrink-0 flex flex-col-reverse gap-2 border-t bg-popover px-4 py-3 sm:px-6 sm:flex-row sm:justify-end pb-safe">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={importing}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleImport}
            disabled={!selectedRoamId || importing || showAuthCta}
          >
            {importing && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Importar transcricao
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
