"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { File, Loader2, Mic, Paperclip, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ConversationFab,
  ConversationPanel,
} from "@/components/ui/conversation";
import { readPlanMode, useChatPlanMode } from "@/hooks/use-chat-plan-mode";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  RoamTranscriptModal,
  type ImportedTranscript,
} from "./roam-transcript-modal";

type UploadedFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  extractedText: string;
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const WELCOME_TEXT =
  "Olá! Sou o Vitor, seu assistente de design de produto. Me conte sobre o projeto — pode descrever em texto livre ou anexar documentos.\n\nQuando sentir que já tem contexto suficiente, clique no botão para eu preencher os próximos steps.";

export function PreWorkStep({
  sessionId,
  data,
  onChange,
}: {
  sessionId: string;
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}) {
  const [files, setFiles] = useState<UploadedFile[]>(
    (data.files as UploadedFile[]) || [],
  );
  const [pendingFiles, setPendingFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [inputText, setInputText] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [roamModalOpen, setRoamModalOpen] = useState(false);
  const [transcripts, setTranscripts] = useState<ImportedTranscript[]>([]);
  const [hasTriggeredFill, setHasTriggeredFill] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadIdRef = useRef<string | null>(threadId);
  threadIdRef.current = threadId;

  const isMobile = useIsMobile();
  const { planMode, setPlanMode } = useChatPlanMode("vitor");

  const persistState = useCallback(
    (updates: Record<string, unknown>) => {
      onChange({ ...data, ...updates });
    },
    [data, onChange],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/design-sessions/${sessionId}/chat`,
        body: {
          sessionId,
          currentStepKey: "pre_work",
          get threadId() {
            return threadIdRef.current;
          },
          get planMode() {
            return readPlanMode("vitor");
          },
        },
      }),
    [sessionId],
  );

  const initialMsg = {
    id: "initial",
    role: "assistant" as const,
    parts: [{ type: "text" as const, text: WELCOME_TEXT }],
  } as UIMessage;

  const { messages, status, sendMessage, stop, setMessages } = useChat({
    transport,
    messages: [initialMsg],
    onFinish: () => {
      onChange({ ...data });
    },
  });

  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/design-sessions/${sessionId}/chat?channel=web&limit=100`)
      .then((r) => {
        if (!r.ok) throw new Error(`Chat history fetch failed: ${r.status}`);
        return r.json();
      })
      .then((result) => {
        if (cancelled) return;
        if (result.threadId) setThreadId(result.threadId);
        if (result.messages?.length) {
          const restored = result.messages
            .filter(
              (m: { role: string }) =>
                m.role === "user" || m.role === "assistant",
            )
            .map((m: { id: string; role: string; content: string }) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              parts: [{ type: "text" as const, text: m.content }],
            }));
          setMessages([initialMsg, ...restored]);
        }
      })
      .catch((err) => {
        console.error("[PreWorkStep] Failed to load chat history:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, setMessages]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/design-sessions/${sessionId}/roam-transcripts`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json) return;
        setTranscripts((json.imported as ImportedTranscript[]) ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleRemoveTranscript = useCallback(
    async (transcriptId: string) => {
      const prev = transcripts;
      setTranscripts((cur) => cur.filter((t) => t.id !== transcriptId));
      const res = await fetch(
        `/api/design-sessions/${sessionId}/roam-transcripts/${transcriptId}`,
        { method: "DELETE" },
      );
      if (!res.ok) setTranscripts(prev);
    },
    [sessionId, transcripts],
  );

  const uploadFiles = useCallback(
    async (fileList: FileList) => {
      setUploading(true);
      const formData = new FormData();
      Array.from(fileList).forEach((f) => formData.append("files", f));
      try {
        const res = await fetch(
          `/api/design-sessions/${sessionId}/upload`,
          { method: "POST", body: formData },
        );
        const result = await res.json();
        const uploaded = (result.files || []) as UploadedFile[];
        const newFiles = [...files, ...uploaded];
        setFiles(newFiles);
        setPendingFiles((prev) => [...prev, ...uploaded]);
        persistState({ files: newFiles });
      } catch {
        // silently handle
      }
      setUploading(false);
    },
    [sessionId, files, persistState],
  );

  const removePendingFile = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
    const updated = files.filter((f) => f.id !== id);
    setFiles(updated);
    persistState({ files: updated });
  };

  const handleSend = useCallback(() => {
    if ((!inputText.trim() && !pendingFiles.length) || uploading || isStreaming)
      return;
    let fullMessage = inputText.trim();
    if (pendingFiles.length > 0) {
      const fileTexts = pendingFiles
        .filter((f) => f.extractedText)
        .map(
          (f) =>
            `\n---\nArquivo: ${f.name} (${formatSize(f.size)})\n${f.extractedText}`,
        )
        .join("");
      if (fileTexts) {
        fullMessage = fullMessage
          ? `${fullMessage}\n${fileTexts}`
          : `Documentos anexados:${fileTexts}`;
      }
    }
    if (!fullMessage) return;
    setInputText("");
    setPendingFiles([]);
    sendMessage({ text: fullMessage });
  }, [inputText, pendingFiles, uploading, isStreaming, sendMessage]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length) {
        uploadFiles(e.dataTransfer.files);
      }
    },
    [uploadFiles],
  );

  const triggerFill = () => {
    setHasTriggeredFill(true);
    sendMessage({
      text: "Agora preencha todos os steps com base no que conversamos. Preencha product_vision, personas_journeys, brainstorm (com campos ricos: keyScreens, userFlows, painPointRef, technicalNotes), hypotheses e technical_specs. Seja completo.",
    });
  };

  const showFillButton =
    !hasTriggeredFill &&
    !isStreaming &&
    messages.filter((m) => m.role === "user").length >= 1;

  const composerLeftActions = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.md,.html,.htm"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) uploadFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading || isStreaming}
        aria-label="Anexar arquivo"
      >
        <Paperclip className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => setRoamModalOpen(true)}
        disabled={isStreaming}
        title="Importar reunião do Roam"
        aria-label="Importar reunião do Roam"
      >
        <Mic className="h-4 w-4" />
      </Button>
    </>
  );

  const composerAboveSlot = (
    <>
      {transcripts.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-border/50 px-4 py-2">
          {transcripts.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-1.5 rounded-lg border bg-muted/40 px-2.5 py-1 text-xs"
              title={t.summary || t.meetingTitle}
            >
              <Mic className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="max-w-[180px] truncate font-medium">
                {t.meetingTitle}
              </span>
              <span className="text-muted-foreground">
                ·{" "}
                {new Date(t.meetingStart).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                })}
              </span>
              <button
                type="button"
                onClick={() => handleRemoveTranscript(t.id)}
                aria-label="Remover transcrição"
              >
                <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </button>
            </div>
          ))}
        </div>
      )}

      {uploading && (
        <div className="flex items-center gap-2 px-4 py-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">Processando arquivos...</span>
        </div>
      )}

      {showFillButton && (
        <div className="flex justify-center border-t border-border/50 px-4 py-2">
          <Button
            variant="outline"
            className="gap-2 border-primary/30 text-primary hover:bg-primary/5"
            onClick={triggerFill}
          >
            <Sparkles className="h-4 w-4" />
            Preencher steps com o que conversamos
          </Button>
        </div>
      )}

      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-border/50 px-4 py-2">
          {pendingFiles.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2 rounded-lg border bg-muted/50 px-2.5 py-1.5 text-xs"
            >
              <File className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="max-w-[150px] truncate font-medium">
                {f.name}
              </span>
              <button
                type="button"
                onClick={() => removePendingFile(f.id)}
                aria-label="Remover anexo"
              >
                <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const submitDisabled =
    (!inputText.trim() && !pendingFiles.length) || uploading;

  const sharedPanelProps = {
    agent: "vitor" as const,
    messages,
    status,
    input: inputText,
    onInputChange: setInputText,
    onSubmit: handleSend,
    onStop: stop,
    planMode,
    onPlanModeChange: setPlanMode,
    placeholder: "Descreva o projeto, cole texto, ou arraste arquivos...",
    composerLeftActions,
    composerAboveSlot,
    composerSubmitDisabled: submitDisabled,
  };

  if (isMobile) {
    return (
      <>
        <ConversationFab
          agent="vitor"
          isOpen={mobileOpen}
          isStreaming={isStreaming}
          onClick={() => setMobileOpen(true)}
        />
        <ConversationPanel
          {...sharedPanelProps}
          variant="mobile"
          isOpen={mobileOpen}
          onOpenChange={setMobileOpen}
          onClose={() => setMobileOpen(false)}
        />
        <RoamTranscriptModal
          sessionId={sessionId}
          open={roamModalOpen}
          onOpenChange={setRoamModalOpen}
          onImported={(t) => setTranscripts((cur) => [t, ...cur])}
        />
      </>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-200px)] max-w-2xl flex-col">
      <div
        className="surface relative flex flex-1 flex-col overflow-hidden"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragging(false);
          }
        }}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/5 backdrop-blur-sm">
            <div className="text-center">
              <Paperclip className="mx-auto mb-2 h-8 w-8 text-primary" />
              <p className="text-sm font-medium text-primary">
                Solte os arquivos aqui
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                PDF, DOCX, TXT, MD, HTML
              </p>
            </div>
          </div>
        )}

        <ConversationPanel {...sharedPanelProps} variant="desktop" />
      </div>

      <RoamTranscriptModal
        sessionId={sessionId}
        open={roamModalOpen}
        onOpenChange={setRoamModalOpen}
        onImported={(t) => setTranscripts((cur) => [t, ...cur])}
      />
    </div>
  );
}
