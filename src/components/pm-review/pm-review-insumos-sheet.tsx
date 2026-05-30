"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Loader2, Plus, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TranscriptModal, ContextInsumosSheet } from "@/components/agent/context-import";
import type { ContextLinkItem } from "@/components/agent/context-import/context-link-list";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { fmtDate as fmtShortDate } from "@/lib/date-utils";

type LinkedTranscript = {
  transcriptRefId: string;
  weight: "primary" | "supporting" | "background" | null;
  transcript: { id: string; source: string; title: string | null; capturedAt: string | null } | null;
};

type LinkedMeeting = { meetingId: string; meeting: { id: string; title: string | null; date: string } | null };
type PoolTranscript = { transcriptRefId: string; source: string; title: string | null; capturedAt: string | null };
type PoolMeeting = { meetingId: string; title: string | null; date: string; hasTranscript: boolean };

type Props = {
  pmReviewId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkedTranscripts: LinkedTranscript[];
  linkedMeetings: LinkedMeeting[];
  onChanged: () => void;
};

export function PMReviewInsumosSheet({ pmReviewId, projectId, open, onOpenChange, linkedTranscripts, linkedMeetings, onChanged }: Props) {
  const [pool, setPool] = useState<{ transcripts: PoolTranscript[]; meetings: PoolMeeting[] } | null>(null);
  const [loadingPool, setLoadingPool] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const loadPool = useCallback(async () => {
    setLoadingPool(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/insumo-pool?excludePMReviewId=${pmReviewId}`);
      setPool(!r.ok ? { transcripts: [], meetings: [] } : await r.json());
    } finally {
      setLoadingPool(false);
    }
  }, [projectId, pmReviewId]);

  useEffect(() => {
    if (open) loadPool();
  }, [open, loadPool]);

  const linkedItems: ContextLinkItem[] = linkedTranscripts.map((l) => ({
    id: l.transcriptRefId,
    title: l.transcript?.title ?? null,
    source: l.transcript?.source ?? "",
    capturedAt: l.transcript?.capturedAt ?? null,
    weight: l.weight,
  }));

  const poolItems: ContextLinkItem[] =
    pool?.transcripts.map((t) => ({ id: t.transcriptRefId, title: t.title, source: t.source, capturedAt: t.capturedAt })) ?? [];

  async function handleLinkTranscript(transcriptRefId: string) {
    await fetchOrThrow(`/api/pm-review/${pmReviewId}/transcripts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ transcriptRefId, weight: "primary" }] }),
    });
    toast.success("Transcript adicionado.");
    await Promise.all([loadPool(), Promise.resolve(onChanged())]);
  }

  async function handleUnlinkTranscript(transcriptRefId: string) {
    await fetchOrThrow(`/api/pm-review/${pmReviewId}/transcripts/${transcriptRefId}`, { method: "DELETE" });
    await Promise.all([loadPool(), Promise.resolve(onChanged())]);
  }

  async function handleAddMeeting(meetingId: string) {
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

  function handleRemoveMeeting(meetingId: string, title: string) {
    setConfirmState({
      title: "Remover reunião deste PM Review?",
      description: `"${title}" será desvinculada.`,
      confirmLabel: "Remover",
      destructive: true,
      onConfirm: async () => {
        setBusy(`m:${meetingId}`);
        try {
          await fetchOrThrow(`/api/pm-review/${pmReviewId}/meetings/${meetingId}`, { method: "DELETE" });
          await Promise.all([loadPool(), Promise.resolve(onChanged())]);
        } catch (err) {
          showErrorToast(err, { label: "Falha ao remover" });
        } finally {
          setBusy(null);
        }
      },
    });
  }

  const meeting = (m: LinkedMeeting | PoolMeeting, isBusy: boolean, onAct?: () => void, isRm?: boolean) => (
    <li key={"meetingId" in m ? m.meetingId : ""} className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-xs">
      <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {("meeting" in m ? m.meeting?.title : "title" in m ? m.title : null) ?? "Reunião sem título"}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          reunião · {fmtShortDate("meeting" in m ? m.meeting?.date ?? "" : "date" in m ? m.date : "")}
          {"hasTranscript" in m && m.hasTranscript && " · com transcript"}
        </p>
      </div>
      {onAct &&
        (isRm ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onAct}
            disabled={isBusy}
          >
            <Unlink className="size-3" />
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" onClick={onAct} disabled={isBusy}>
            <Plus className="size-3" /> adicionar
          </Button>
        ))}
    </li>
  );

  return (
    <>
      <ContextInsumosSheet
        open={open}
        onOpenChange={onOpenChange}
        title="Insumos do PM Review"
        scope="project"
        linkedTranscripts={linkedItems}
        poolTranscripts={poolItems}
        onLink={handleLinkTranscript}
        onUnlink={handleUnlinkTranscript}
        onImportNew={() => setImportModalOpen(true)}
        showWeight
        scopeLabel={{ linked: `Insumos deste PM Review (${linkedTranscripts.length + linkedMeetings.length})` }}
        linkedExtras={
          linkedMeetings.length > 0 && (
            <ul className="space-y-1.5 mt-1.5">
              {linkedMeetings.map((l) => meeting(l, busy === `m:${l.meetingId}`, () => handleRemoveMeeting(l.meetingId, l.meeting?.title ?? "reunião"), true))}
            </ul>
          )
        }
        poolExtras={
          loadingPool ? (
            <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Carregando pool…
            </div>
          ) : (
            pool &&
            pool.meetings.length > 0 && (
              <>
                <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Reuniões do pool ({pool.meetings.length})
                </h3>
                <ul className="space-y-1.5">{pool.meetings.map((m) => meeting(m, busy === `m:${m.meetingId}`, () => handleAddMeeting(m.meetingId), false))}</ul>
              </>
            )
          )
        }
      />
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
