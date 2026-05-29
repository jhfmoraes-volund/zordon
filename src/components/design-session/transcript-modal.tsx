"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2,
  Mic,
  AlertTriangle,
  RefreshCw,
  Search,
  Check,
  CheckCircle2,
  Users,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * Shape leve do "transcript importado" devolvido pelos endpoints de listagem
 * (DS: `/api/design-sessions/[id]/transcripts`, Planning:
 * `/api/planning/[id]/transcripts/sources`). Após Fundação B (TranscriptRef
 * = SSOT), ambos retornam a mesma forma — `id` é o link id (estável p/ DELETE).
 */
export type ImportedTranscript = {
  /** Link id (estável p/ DELETE). */
  id: string;
  source: string;
  sourceId: string | null;
  meetingTitle: string | null;
  meetingStart: string | null;
  summary: string | null;
};

type SourceKey = "roam" | "granola";

interface ImportableMeeting {
  source: SourceKey;
  id: string;
  title: string;
  start: string;
  end?: string;
  durationMinutes?: number;
  participants: { name: string; email?: string }[];
  alreadyImported: boolean;
}

interface SourceSlice {
  needsAuth: boolean;
  available: ImportableMeeting[];
  error?: string;
}

interface ApiResponse {
  sources: Record<SourceKey, SourceSlice>;
  imported: ImportedTranscript[];
}

const SOURCE_LABEL: Record<SourceKey, string> = {
  roam: "Roam",
  granola: "Granola",
};

const LAST_SOURCE_KEY = "volund:lastTranscriptSource";

const fmtDay = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  weekday: "short",
});
const fmtTime = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
});

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function groupByDay(items: ImportableMeeting[]): { day: string; sample: string; items: ImportableMeeting[] }[] {
  const groups = new Map<string, ImportableMeeting[]>();
  for (const m of items) {
    const k = dayKey(m.start);
    const bucket = groups.get(k);
    if (bucket) bucket.push(m);
    else groups.set(k, [m]);
  }
  return Array.from(groups.entries()).map(([day, list]) => ({
    day,
    sample: list[0].start,
    items: list,
  }));
}

export function TranscriptModal({
  apiUrl,
  open,
  onOpenChange,
  onImported,
  subtitle,
}: {
  /** Base URL for both GET (list importable) and POST (import). */
  apiUrl: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (t: ImportedTranscript) => void;
  subtitle?: string;
}) {
  const isMobile = useIsMobile();
  const router = useRouter();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<SourceKey>(() => {
    if (typeof window === "undefined") return "roam";
    const cached = window.localStorage.getItem(LAST_SOURCE_KEY);
    return cached === "granola" ? "granola" : "roam";
  });
  const [selected, setSelected] = useState<{ source: SourceKey; id: string } | null>(null);
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(apiUrl);
      if (!res.ok) {
        setLoadError(`HTTP ${res.status}`);
        return;
      }
      const json = (await res.json()) as ApiResponse;
      setData(json);
      const cached = window.localStorage.getItem(LAST_SOURCE_KEY) as SourceKey | null;
      const candidate =
        cached && json.sources[cached]?.available.length > 0
          ? cached
          : json.sources.roam.available.length > 0
            ? "roam"
            : json.sources.granola.available.length > 0
              ? "granola"
              : (cached ?? "roam");
      setActiveSource(candidate);
    } catch (err) {
      setLoadError((err as Error).message || "Erro de rede");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setQuery("");
    setImportError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, apiUrl]);

  const handleSelectSource = (s: SourceKey) => {
    setActiveSource(s);
    setSelected(null);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LAST_SOURCE_KEY, s);
    }
  };

  const activeSlice: SourceSlice | null = data ? data.sources[activeSource] : null;

  const filteredItems = useMemo(() => {
    if (!activeSlice) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return activeSlice.available;
    return activeSlice.available.filter((m) => {
      if (m.title.toLowerCase().includes(needle)) return true;
      return m.participants.some((p) => p.name?.toLowerCase().includes(needle));
    });
  }, [activeSlice, query]);

  const grouped = useMemo(() => groupByDay(filteredItems), [filteredItems]);

  const handleImport = async () => {
    if (!selected) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: selected.source, sourceId: selected.id }),
      });
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
            Importar transcrição
          </SheetTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {subtitle ?? "Vitor vai usar a transcrição como contexto da sessão."}
          </p>

          <div
            role="tablist"
            aria-label="Fontes de transcrição"
            className="mt-4 inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-1"
          >
            {(["roam", "granola"] as const).map((s) => {
              const slice = data?.sources[s];
              const count = slice?.available.length ?? 0;
              const isActive = activeSource === s;
              return (
                <button
                  key={s}
                  role="tab"
                  aria-selected={isActive}
                  type="button"
                  onClick={() => handleSelectSource(s)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span>{SOURCE_LABEL[s]}</span>
                  {!loading && slice && !slice.needsAuth && (
                    <Badge
                      variant={isActive ? "default" : "secondary"}
                      className="h-5 px-1.5 text-[10px]"
                    >
                      {count}
                    </Badge>
                  )}
                  {slice?.needsAuth && (
                    <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-4">
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[72px] w-full" />
                ))}
              </div>
            </div>
          )}

          {!loading && loadError && (
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

          {!loading && !loadError && activeSlice && (
            <>
              {!activeSlice.needsAuth && activeSlice.available.length > 0 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filtrar por título ou participante"
                    className="pl-9"
                  />
                </div>
              )}

              {activeSlice.needsAuth && (
                <AuthCTA
                  source={activeSource}
                  onSettings={() => router.push("/settings/integrations")}
                />
              )}

              {activeSlice.error && !activeSlice.needsAuth && (
                <div className="rounded-lg border border-amber-300/40 bg-amber-50/40 dark:bg-amber-950/20 p-3 text-xs text-amber-900 dark:text-amber-200">
                  {activeSlice.error}
                </div>
              )}

              {!activeSlice.needsAuth && !activeSlice.error && activeSlice.available.length === 0 && (
                <div className="py-12 text-center">
                  <Mic className="mx-auto h-6 w-6 text-muted-foreground/60" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Nenhuma reunião recente encontrada no {SOURCE_LABEL[activeSource]}.
                  </p>
                </div>
              )}

              {!activeSlice.needsAuth && filteredItems.length > 0 && (
                <div className="space-y-4">
                  {grouped.map((group) => (
                    <div key={group.day}>
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        {fmtDay.format(new Date(group.sample))}
                      </p>
                      <div className="space-y-2">
                        {group.items.map((m) => (
                          <MeetingCard
                            key={m.id}
                            meeting={m}
                            selected={selected?.source === activeSource && selected.id === m.id}
                            onSelect={() => setSelected({ source: activeSource, id: m.id })}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!activeSlice.needsAuth && activeSlice.available.length > 0 && filteredItems.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nenhuma reunião combina com &ldquo;{query}&rdquo;.
                </p>
              )}
            </>
          )}

          {importError && <p className="text-sm text-destructive">{importError}</p>}
        </div>

        <div className="shrink-0 flex flex-col-reverse gap-2 border-t bg-popover px-4 py-3 sm:px-6 sm:flex-row sm:justify-end pb-safe">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancelar
          </Button>
          <Button onClick={handleImport} disabled={!selected || importing}>
            {importing && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Importar transcrição
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AuthCTA({ source, onSettings }: { source: SourceKey; onSettings: () => void }) {
  if (source === "roam") {
    return (
      <div className="rounded-lg border bg-muted/30 p-4 text-sm">
        <p className="font-medium mb-1">Conecte sua conta Roam</p>
        <p className="text-muted-foreground mb-3">
          Você ainda não conectou seu token Roam. Conecte para listar suas reuniões.
        </p>
        <Button size="sm" onClick={onSettings}>
          Ir para integrações
        </Button>
      </div>
    );
  }
  return (
    <div className="rounded-lg border bg-muted/30 p-4 text-sm">
      <p className="font-medium mb-1">Granola não está configurado</p>
      <p className="text-muted-foreground">
        Esta workspace ainda não tem a chave do Granola (variável de ambiente
        <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">GRANOLA_KEY</code>).
        Peça ao admin para configurar.
      </p>
    </div>
  );
}

function MeetingCard({
  meeting,
  selected,
  onSelect,
}: {
  meeting: ImportableMeeting;
  selected: boolean;
  onSelect: () => void;
}) {
  const disabled = meeting.alreadyImported;
  const time = fmtTime.format(new Date(meeting.start));
  const people = meeting.participants.map((p) => p.name).filter(Boolean);
  const peopleSummary =
    people.length > 0
      ? people.slice(0, 4).join(", ") + (people.length > 4 ? `, +${people.length - 4}` : "")
      : null;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "group relative w-full rounded-lg border p-3 text-left transition-all",
        disabled
          ? "cursor-not-allowed bg-muted/30 opacity-60"
          : selected
            ? "border-primary bg-primary/5 shadow-sm"
            : "hover:border-primary/40 hover:bg-muted/40",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">{meeting.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {time}
              {meeting.durationMinutes ? ` · ${meeting.durationMinutes} min` : ""}
            </span>
            {people.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                {people.length} {people.length === 1 ? "pessoa" : "pessoas"}
              </span>
            )}
          </div>
          {peopleSummary && (
            <p className="mt-1 truncate text-xs text-muted-foreground/80">{peopleSummary}</p>
          )}
        </div>

        {disabled ? (
          <Badge variant="secondary" className="shrink-0 gap-1">
            <Check className="h-3 w-3" /> Importada
          </Badge>
        ) : (
          selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        )}
      </div>
    </button>
  );
}
