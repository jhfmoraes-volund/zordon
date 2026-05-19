"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Loader2, Mic, AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import type { RoamTranscriptListItem } from "@/lib/roam";
import type { MeetingType } from "./meeting-sheet";
import { useAlphaChat } from "@/components/alpha-chat";

type ApiResponse = {
  needsAuth: boolean;
  available: RoamTranscriptListItem[];
  error?: string;
};

type AttendeeInput = {
  memberId?: string | null;
  externalName?: string | null;
  externalEmail?: string | null;
  externalRole?: string | null;
  role?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
} & (
  | {
      /** Cria a Meeting + ingere. Usado pelo botão no MeetingSheet. */
      mode: "create";
      type: MeetingType;
      pmMemberIds: string[];
      attendees: AttendeeInput[];
      projectIds: string[];
    }
  | {
      /** Reusa uma Meeting já existente; só dispara a ingestão pelo Alpha. */
      mode: "existing";
      meetingId: string;
    }
);

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

export function ImportRoamMeetingModal(props: Props) {
  const { open, onOpenChange, mode } = props;
  const isMobile = useIsMobile();
  const router = useRouter();
  const { kickoffIngest } = useAlphaChat();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRoamId, setSelectedRoamId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/integrations/roam/meetings");
      if (!res.ok) {
        setLoadError(`HTTP ${res.status}`);
        return;
      }
      setData((await res.json()) as ApiResponse);
    } catch (err) {
      setLoadError((err as Error).message || "Erro de rede");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSelectedRoamId(null);
    load();
  }, [open]);

  const handleConfirm = async () => {
    if (!selectedRoamId || submitting) return;
    const transcript = data?.available.find((t) => t.id === selectedRoamId);
    if (!transcript) return;

    setSubmitting(true);
    try {
      let meetingId: string;
      let needsNavigate = false;

      if (props.mode === "create") {
        // Cria a Meeting com data = início da transcrição, título = eventName.
        const meetingDate = transcript.start.slice(0, 10);
        const title = transcript.eventName?.trim() || null;
        const body = {
          type: props.type,
          date: `${meetingDate}T12:00:00`,
          title,
          notes: null,
          pmMemberIds: props.type === "pm_review" ? props.pmMemberIds : [],
          attendees: props.attendees,
          projectIds: ["general", "daily", "super_planning"].includes(props.type)
            ? props.projectIds
            : [],
        };
        const res = await fetchOrThrow("/api/meetings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const created = (await res.json()) as { id: string };
        meetingId = created.id;
        // No fluxo "create" o user está no MeetingSheet (página de listagem ou
        // outra). Navega pra detail da meeting recém-criada pra ele acompanhar
        // o Alpha popular o conteúdo. O side sheet do Alpha é global, então
        // sobrevive à navegação.
        needsNavigate = true;
      } else {
        meetingId = props.meetingId;
      }

      kickoffIngest({
        meetingId,
        source: "roam",
        sourceId: transcript.id,
        overwrite: props.mode === "existing",
      });
      onOpenChange(false);
      if (needsNavigate) router.push(`/meetings/${meetingId}`);
    } catch (err) {
      showErrorToast(err, { label: "Importar reunião" });
    } finally {
      setSubmitting(false);
    }
  };

  const showAuthCta = !!(data?.needsAuth || (data?.error && data.available.length === 0));

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
            Importar reunião do Roam
          </SheetTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Escolha uma transcrição. Alpha cria a reunião e ingere o conteúdo
            automaticamente.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Carregando reuniões…</span>
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
                  "Você ainda não conectou seu token do Roam. Conecte para listar suas reuniões."}
              </p>
              <Button
                size="sm"
                onClick={() => router.push("/settings/integrations")}
              >
                Ir para integrações
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
                  Nenhuma reunião recente encontrada no Roam.
                </p>
              ) : (
                <div className="space-y-2">
                  {data.available.map((t) => {
                    const isSelected = selectedRoamId === t.id;
                    const dur = durationMin(t.start, t.end);
                    const people = t.participants
                      .map((p) => p.name)
                      .filter(Boolean);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedRoamId(t.id)}
                        className={cn(
                          "w-full text-left rounded-lg border p-3 transition-colors",
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "hover:border-primary/40 hover:bg-muted/30",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">
                            {t.eventName?.trim() || "Reunião sem título"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {fmtDateTime.format(new Date(t.start))} · {dur} min ·{" "}
                            {people.length}{" "}
                            {people.length === 1 ? "pessoa" : "pessoas"}
                          </p>
                          {people.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1 truncate">
                              {people.join(", ")}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 flex flex-col-reverse gap-2 border-t bg-popover px-4 py-3 sm:px-6 sm:flex-row sm:justify-end pb-safe">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedRoamId || submitting || showAuthCta}
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Criar e ingerir
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
