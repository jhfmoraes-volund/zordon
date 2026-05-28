"use client";

import { useState } from "react";
import { FileText, Unlink } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetFooter,
} from "@/components/ui/responsive-sheet";
import { SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TranscriptModal } from "@/components/design-session/transcript-modal";
import { fmtDate } from "@/lib/date-utils";

interface LinkedTranscript {
  transcriptRefId: string;
  transcript: {
    id: string;
    title: string | null;
    source: string;
    capturedAt: string | null;
  } | null;
  weight: string;
}

interface ContextSheetProps {
  planningId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  linkedTranscripts: LinkedTranscript[];
  onUnlink: (transcriptRefId: string, title: string) => void;
  onImported: () => void;
}

export function ContextSheet({
  planningId,
  open,
  onOpenChange,
  linkedTranscripts,
  onUnlink,
  onImported,
}: ContextSheetProps) {
  const [transcriptModalOpen, setTranscriptModalOpen] = useState(false);

  return (
    <>
      <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
        <ResponsiveSheetContent size="sm" showCloseButton>
          <ResponsiveSheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Contexto da planning
            </SheetTitle>
          </ResponsiveSheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {linkedTranscripts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma transcrição importada ainda.
              </p>
            ) : (
              <ul className="divide-y">
                {linkedTranscripts.map((l) => (
                  <li key={l.transcriptRefId} className="flex items-center gap-2 py-3">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">
                        {l.transcript?.title ?? "Transcript sem título"}
                      </p>
                      {l.transcript?.capturedAt && (
                        <p className="text-xs text-muted-foreground">
                          {l.transcript.source} · {fmtDate(l.transcript.capturedAt)}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0 capitalize">
                      {l.weight}
                    </Badge>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      title="Desvincular"
                      onClick={() =>
                        onUnlink(
                          l.transcriptRefId,
                          l.transcript?.title ?? "este transcript",
                        )
                      }
                    >
                      <Unlink className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <ResponsiveSheetFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            <Button onClick={() => setTranscriptModalOpen(true)}>
              Importar transcrição
            </Button>
          </ResponsiveSheetFooter>
        </ResponsiveSheetContent>
      </ResponsiveSheet>

      <TranscriptModal
        apiUrl={`/api/planning/${planningId}/transcripts/sources`}
        open={transcriptModalOpen}
        onOpenChange={setTranscriptModalOpen}
        subtitle="Vitória vai usar a transcrição como contexto da planning."
        onImported={() => {
          setTranscriptModalOpen(false);
          onImported();
        }}
      />
    </>
  );
}
