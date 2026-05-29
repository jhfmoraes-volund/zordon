"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  FileText,
  Loader2,
  Mic,
  Plus,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
  ResponsiveSheetFooter,
} from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import { TranscriptModal } from "@/components/design-session/transcript-modal";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { fmtDate as fmtShortDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

type LinkedTranscript = {
  transcriptRefId: string;
  weight: "primary" | "supporting" | "background" | null;
  transcript: {
    id: string;
    source: string;
    sourceId: string | null;
    title: string | null;
    capturedAt: string | null;
  } | null;
};

type LinkedMeeting = {
  meetingId: string;
  meeting: {
    id: string;
    title: string | null;
    date: string;
    visibility: string;
    kind: string;
  } | null;
};

type PoolTranscript = {
  transcriptRefId: string;
  source: string;
  sourceId: string | null;
  title: string | null;
  capturedAt: string | null;
  origin: {
    kind: "planning" | "pm_review";
    label: string;
    ritualId: string;
  } | null;
};

type PoolMeeting = {
  meetingId: string;
  title: string | null;
  date: string;
  hasTranscript: boolean;
  notesPreview: string | null;
};

type Props = {
  pmReviewId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkedTranscripts: LinkedTranscript[];
  linkedMeetings: LinkedMeeting[];
  /** Reload do PM Review detail (caller). */
  onChanged: () => void;
};

export function PMReviewInsumosSheet({
  pmReviewId,
  projectId,
  open,
  onOpenChange,
  linkedTranscripts,
  linkedMeetings,
  onChanged,
}: Props) {
  const [pool, setPool] = useState<{
    transcripts: PoolTranscript[];
    meetings: PoolMeeting[];
  } | null>(null);
  const [loadingPool, setLoadingPool] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const loadPool = useCallback(async () => {
    setLoadingPool(true);
    try {
      const r = await fetch(
        `/api/projects/${projectId}/insumo-pool?excludePMReviewId=${pmReviewId}`,
      );
      if (!r.ok) {
        setPool({ transcripts: [], meetings: [] });
        return;
      }
      setPool(await r.json());
    } finally {
      setLoadingPool(false);
    }
  }, [projectId, pmReviewId]);

  useEffect(() => {
    if (!open) return;
    loadPool();
  }, [open, loadPool]);

  async function handleAddTranscriptFromPool(transcriptRefId: string) {
    setBusy(`tr:${transcriptRefId}`);
    try {
      await fetchOrThrow(`/api/pm-review/${pmReviewId}/transcripts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ transcriptRefId, weight: "primary" }],
        }),
      });
      toast.success("Transcript adicionado.");
      await Promise.all([loadPool(), Promise.resolve(onChanged())]);
    } catch (err) {
      showErrorToast(err, { label: "Falha ao adicionar transcript" });
    } finally {
      setBusy(null);
    }
  }

  async function handleAddMeetingFromPool(meetingId: string) {
    setBusy(`m:${meetingId}`);
    try {
      await fetchOrThrow(`/api/pm-review/${pmReviewId}/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ meetingId }] }),
      });
      toast.success("Reunião adicionada.");
      await Promise.all([loadPool(), Promise.resolve(onChanged())]);
    } catch (err) {
      showErrorToast(err, { label: "Falha ao adicionar reunião" });
    } finally {
      setBusy(null);
    }
  }

  function handleRemoveTranscript(transcriptRefId: string, title: string) {
    setConfirmState({
      title: "Remover transcript deste PM Review?",
      description: `"${title}" será desvinculado. O transcript continua disponível no pool do projeto.`,
      confirmLabel: "Remover",
      destructive: true,
      onConfirm: async () => {
        setBusy(`tr:${transcriptRefId}`);
        try {
          await fetchOrThrow(
            `/api/pm-review/${pmReviewId}/transcripts/${transcriptRefId}`,
            { method: "DELETE" },
          );
          await Promise.all([loadPool(), Promise.resolve(onChanged())]);
        } catch (err) {
          showErrorToast(err, { label: "Falha ao remover" });
        } finally {
          setBusy(null);
        }
      },
    });
  }

  function handleRemoveMeeting(meetingId: string, title: string) {
    setConfirmState({
      title: "Remover reunião deste PM Review?",
      description: `"${title}" será desvinculada. A reunião continua disponível no pool do projeto.`,
      confirmLabel: "Remover",
      destructive: true,
      onConfirm: async () => {
        setBusy(`m:${meetingId}`);
        try {
          await fetchOrThrow(
            `/api/pm-review/${pmReviewId}/meetings/${meetingId}`,
            { method: "DELETE" },
          );
          await Promise.all([loadPool(), Promise.resolve(onChanged())]);
        } catch (err) {
          showErrorToast(err, { label: "Falha ao remover" });
        } finally {
          setBusy(null);
        }
      },
    });
  }

  const sourceIcon = (source: string) =>
    source === "granola" || source === "roam" ? (
      <Mic className="size-3.5 shrink-0 text-muted-foreground" />
    ) : (
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
    );

  const totalLinked = linkedTranscripts.length + linkedMeetings.length;
  const totalPool = (pool?.transcripts.length ?? 0) + (pool?.meetings.length ?? 0);

  return (
    <>
      <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
        <ResponsiveSheetContent size="md">
          <ResponsiveSheetHeader>
            <ResponsiveSheetTitle>Insumos do PM Review</ResponsiveSheetTitle>
          </ResponsiveSheetHeader>

          <ResponsiveSheetBody>
            <div className="space-y-6">
              {/* Section 1 — Linkados a este PM Review */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Insumos deste PM Review ({totalLinked})
                </h3>
                {totalLinked === 0 ? (
                  <p className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
                    Nada linkado ainda. Use o pool abaixo ou importe novo.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {linkedTranscripts.map((l) => (
                      <li
                        key={l.transcriptRefId}
                        className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs"
                      >
                        {sourceIcon(l.transcript?.source ?? "")}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {l.transcript?.title ?? "Transcript sem título"}
                          </p>
                          <p className="truncate text-[10px] text-muted-foreground">
                            {l.transcript?.source}
                            {l.transcript?.capturedAt &&
                              ` · ${fmtShortDate(l.transcript.capturedAt)}`}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() =>
                            handleRemoveTranscript(
                              l.transcriptRefId,
                              l.transcript?.title ?? "transcript",
                            )
                          }
                          disabled={busy === `tr:${l.transcriptRefId}`}
                        >
                          <Unlink className="size-3" />
                        </Button>
                      </li>
                    ))}
                    {linkedMeetings.map((l) => (
                      <li
                        key={l.meetingId}
                        className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs"
                      >
                        <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {l.meeting?.title ?? "Reunião sem título"}
                          </p>
                          <p className="truncate text-[10px] text-muted-foreground">
                            reunião · {l.meeting && fmtShortDate(l.meeting.date)}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() =>
                            handleRemoveMeeting(
                              l.meetingId,
                              l.meeting?.title ?? "reunião",
                            )
                          }
                          disabled={busy === `m:${l.meetingId}`}
                        >
                          <Unlink className="size-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Section 2 — Pool do projeto */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Pool do projeto ({loadingPool ? "…" : totalPool})
                </h3>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Insumos já usados em outras Plannings/PM Reviews deste projeto.
                  Adicione com 1 clique — o material é compartilhado.
                </p>
                {loadingPool ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Carregando pool…
                  </div>
                ) : totalPool === 0 ? (
                  <p className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
                    Pool vazio. Este é o primeiro ritual a curar insumos no projeto
                    — importe novo abaixo.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {pool?.transcripts.map((t) => (
                      <li
                        key={t.transcriptRefId}
                        className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs"
                      >
                        {sourceIcon(t.source)}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {t.title ?? "Transcript sem título"}
                          </p>
                          <p className="truncate text-[10px] text-muted-foreground">
                            {t.source}
                            {t.capturedAt && ` · ${fmtShortDate(t.capturedAt)}`}
                            {t.origin && ` · ${t.origin.label}`}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 gap-1 px-2 text-[10px]"
                          onClick={() =>
                            handleAddTranscriptFromPool(t.transcriptRefId)
                          }
                          disabled={busy === `tr:${t.transcriptRefId}`}
                        >
                          <Plus className="size-3" /> adicionar
                        </Button>
                      </li>
                    ))}
                    {pool?.meetings.map((m) => (
                      <li
                        key={m.meetingId}
                        className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs"
                      >
                        <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">
                            {m.title ?? "Reunião sem título"}
                          </p>
                          <p className="truncate text-[10px] text-muted-foreground">
                            reunião · {fmtShortDate(m.date)}
                            {m.hasTranscript && " · com transcript"}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 gap-1 px-2 text-[10px]"
                          onClick={() => handleAddMeetingFromPool(m.meetingId)}
                          disabled={busy === `m:${m.meetingId}`}
                        >
                          <Plus className="size-3" /> adicionar
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Section 3 — Importar novo */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Importar novo (Roam / Granola)
                </h3>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Busca diretamente no Roam ou Granola. O transcript fica
                  disponível pro pool do projeto pra próximos rituais.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setImportModalOpen(true)}
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

      <TranscriptModal
        apiUrl={`/api/pm-review/${pmReviewId}/transcripts/sources`}
        open={importModalOpen}
        onOpenChange={setImportModalOpen}
        onImported={() => {
          loadPool();
          onChanged();
        }}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </>
  );
}
