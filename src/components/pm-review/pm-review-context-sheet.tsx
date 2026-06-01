"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import ContextSheet from "@/components/agent/context-import/context-sheet";
import { TranscriptModal } from "@/components/agent/context-import";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";

type LinkedTranscript = {
  transcriptRefId: string;
  weight: "primary" | "supporting" | "background" | null;
  transcript: { id: string; source: string | null; title: string | null; capturedAt: string | null } | null;
};

type LinkedMeeting = { meetingId: string; meeting: { id: string; title: string | null; date: string } | null };

type Props = {
  pmReviewId: string;
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkedTranscripts: LinkedTranscript[];
  linkedMeetings: LinkedMeeting[];
  onChanged: () => void;
};

export function PMReviewContextSheet({ pmReviewId, projectId, open, onOpenChange, linkedTranscripts, linkedMeetings, onChanged }: Props) {
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  // Map linked transcripts to ContextSheet format
  const linkedItems = linkedTranscripts.map((l) => ({
    id: l.transcriptRefId,
    kind: "transcript" as const,
    title: l.transcript?.title ?? null,
    source: l.transcript?.source ?? "",
    capturedAt: l.transcript?.capturedAt ?? null,
    weight: l.weight ?? undefined,
  }));

  async function handleUnlink(itemId: string, itemTitle: string) {
    setConfirmState({
      title: "Desvincular fonte?",
      description: `"${itemTitle}" será removida deste PM Review.`,
      confirmLabel: "Desvincular",
      destructive: true,
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/pm-review/${pmReviewId}/transcripts/${itemId}`, { method: "DELETE" });
          toast.success("Fonte desvinculada.");
          onChanged();
        } catch (err) {
          showErrorToast(err, { label: "Falha ao desvincular" });
        }
      },
    });
  }

  function handleImportTranscript() {
    setImportModalOpen(true);
  }

  return (
    <>
      <ContextSheet
        open={open}
        onOpenChange={onOpenChange}
        ritualLabel="PM Review"
        linkedItems={linkedItems}
        capabilities={{
          transcript: true,
          spreadsheet: false,
          github: false,
        }}
        handlers={{
          onUnlink: handleUnlink,
          onImportTranscript: handleImportTranscript,
        }}
      />

      <TranscriptModal
        apiUrl={`/api/pm-review/${pmReviewId}/transcripts/sources`}
        open={importModalOpen}
        onOpenChange={setImportModalOpen}
        onImported={() => {
          onChanged();
        }}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </>
  );
}
