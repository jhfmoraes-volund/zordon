"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { fmtDateNumeric } from "@/lib/date-utils";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { File, Loader2, Mic, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConversationPanel } from "@/components/ui/conversation";
import { readPlanMode, useChatPlanMode } from "@/hooks/use-chat-plan-mode";
import {
  TranscriptModal,
  type ImportedTranscript,
} from "@/components/agent/context-import";
import ContextSheet from "@/components/agent/context-import/context-sheet";
import {
  useSessionFiles,
  type SessionFileRow,
} from "@/hooks/design-session/use-session-files";
import { PrdBriefingRibbon } from "@/components/sessions/prd-session/prd-briefing-ribbon";
import { PrdCard } from "@/components/sessions/prd-session/prd-card";
import type { ProductRequirementRow } from "@/lib/dal/product-requirements";

const WELCOME_TEXT =
  "Olá! Sou o Vitor. Vamos refinar esses PRDs juntos antes de mandar pra Forja — me peça pra detalhar AC, descobrir gaps, dividir ou consolidar PRDs.";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function computeStats(prds: ProductRequirementRow[]) {
  let ready = 0;
  let draft = 0;
  for (const p of prds) {
    if (p.status === "approved" || p.status === "ready") ready += 1;
    else if (p.status === "draft" || p.status === "review") draft += 1;
  }
  return { total: prds.length, ready, draft };
}

type Props = {
  sessionId: string;
  projectId: string;
};

/**
 * Step único pra sessions tipo `prd_session` (upload ou quick_ask).
 *
 * Layout:
 *   • Ribbon (stats de PRDs + insumos + enviar pra Forja)
 *   • Esquerda: lista de PRDs vinculados (cards collapsable)
 *   • Direita: chat com Vitor (mesmo transport do pre_work, currentStepKey `prd_briefing`)
 *
 * Infra de insumos (transcripts + files) reusa exatamente o que o pre_work
 * usa: `useSessionFiles`, `TranscriptModal`, `ContextSheet`.
 */
export function PrdBriefingStep({ sessionId, projectId }: Props) {
  const [approvingAll, setApprovingAll] = useState(false);

  const {
    uploading,
    uploadFiles: uploadFilesHook,
    deleteFile,
    getExtractedText,
  } = useSessionFiles(sessionId);

  const [prds, setPrds] = useState<ProductRequirementRow[]>([]);
  const [prdsLoading, setPrdsLoading] = useState(true);
  const [pendingFiles, setPendingFiles] = useState<SessionFileRow[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [inputText, setInputText] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [roamModalOpen, setRoamModalOpen] = useState(false);
  const [transcripts, setTranscripts] = useState<ImportedTranscript[]>([]);
  const [insumosOpen, setInsumosOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadIdRef = useRef<string | null>(threadId);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  const { planMode, setPlanMode } = useChatPlanMode("vitor");

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/design-sessions/${sessionId}/chat`,
        body: {
          sessionId,
          currentStepKey: "prd_briefing",
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

  const initialMsg = useMemo<UIMessage>(
    () =>
      ({
        id: "initial",
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: WELCOME_TEXT }],
      }) as UIMessage,
    [],
  );

  const { messages, status, sendMessage, stop, setMessages } = useChat({
    transport,
    messages: [initialMsg],
  });

  const isStreaming = status === "streaming" || status === "submitted";

  // Load chat history
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/design-sessions/${sessionId}/chat?channel=web&limit=100`)
      .then((r) => (r.ok ? r.json() : null))
      .then((result) => {
        if (cancelled || !result) return;
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
        console.error("[PrdBriefingStep] Failed to load chat history:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, setMessages, initialMsg]);

  // Load PRDs
  const loadPrds = useCallback(async () => {
    try {
      const r = await fetch(`/api/design-sessions/${sessionId}/prds`);
      if (!r.ok) return;
      const json = (await r.json()) as { prds: ProductRequirementRow[] };
      setPrds(json.prds ?? []);
    } finally {
      setPrdsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadPrds();
  }, [loadPrds]);

  // Re-fetch PRDs after each Vitor response (tool calls may have mutated them).
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if ((prev === "streaming" || prev === "submitted") && status === "ready") {
      void loadPrds();
    }
  }, [status, loadPrds]);

  // Load transcripts
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/design-sessions/${sessionId}/transcripts`)
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

  const handleUnlinkTranscript = useCallback(
    async (transcriptId: string) => {
      const prev = transcripts;
      setTranscripts((cur) => cur.filter((t) => t.id !== transcriptId));
      const res = await fetch(
        `/api/design-sessions/${sessionId}/transcripts/${transcriptId}`,
        { method: "DELETE" },
      );
      if (!res.ok) setTranscripts(prev);
    },
    [sessionId, transcripts],
  );

  const linkedItems = useMemo(
    () =>
      transcripts.map((t) => ({
        id: t.id,
        kind: "transcript" as const,
        title: t.meetingTitle,
        source: t.source,
        capturedAt: t.meetingStart,
      })),
    [transcripts],
  );

  const uploadFiles = useCallback(
    async (fileList: FileList) => {
      const uploaded = await uploadFilesHook(fileList);
      if (uploaded.length > 0) {
        setPendingFiles((cur) => [...cur, ...uploaded]);
      }
    },
    [uploadFilesHook],
  );

  const removePendingFile = (id: string) => {
    setPendingFiles((cur) => cur.filter((f) => f.id !== id));
    void deleteFile(id);
  };

  const handleSend = useCallback(async () => {
    if ((!inputText.trim() && !pendingFiles.length) || uploading || isStreaming)
      return;
    let fullMessage = inputText.trim();
    if (pendingFiles.length > 0) {
      const texts = await Promise.all(
        pendingFiles.map(async (f) => {
          const text = await getExtractedText(f.id);
          const header = `\n---\nArquivo: ${f.name} (${formatSize(f.size)})`;
          if (text && text.trim()) return `${header}\n${text}`;
          return `${header}\n[Conteúdo não extraído]`;
        }),
      );
      const fileTexts = texts.join("");
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
  }, [
    inputText,
    pendingFiles,
    uploading,
    isStreaming,
    sendMessage,
    getExtractedText,
  ]);

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

  const composerLeftActions = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.txt,.md,.html,.htm,.csv,.xlsx,.xls"
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
        title="Importar reunião"
        aria-label="Importar reunião"
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
              title={t.summary ?? t.meetingTitle ?? undefined}
            >
              <Mic className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="max-w-[180px] truncate font-medium">
                {t.meetingTitle}
              </span>
              <span className="text-muted-foreground">
                · {fmtDateNumeric(t.meetingStart)}
              </span>
              <button
                type="button"
                onClick={() => handleUnlinkTranscript(t.id)}
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

  const stats = computeStats(prds);
  const insumosCount = transcripts.length + pendingFiles.length;

  const handleApproveAll = useCallback(async () => {
    const pending = prds.filter(
      (p) => p.status === "draft" || p.status === "review",
    );
    if (pending.length === 0) return;
    setApprovingAll(true);
    try {
      const results = await Promise.allSettled(
        pending.map((p) =>
          fetch(`/api/prds/${p.id}/approve`, { method: "POST" }).then(
            async (r) => {
              if (!r.ok) {
                const json = await r.json().catch(() => ({}));
                throw new Error(json.error ?? `HTTP ${r.status}`);
              }
              return r;
            },
          ),
        ),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - ok;
      if (failed === 0) {
        toast.success(`${ok} PRD${ok > 1 ? "s" : ""} aprovado${ok > 1 ? "s" : ""}.`);
      } else {
        const firstErr = (results.find((r) => r.status === "rejected") as PromiseRejectedResult)?.reason;
        toast.warning(
          `${ok} aprovado${ok !== 1 ? "s" : ""}, ${failed} falhou${failed !== 1 ? "ram" : ""}: ${String(firstErr?.message ?? firstErr)}`,
        );
      }
      await loadPrds();
    } finally {
      setApprovingAll(false);
    }
  }, [prds, loadPrds]);

  return (
    <div className="w-full -m-6 h-full flex flex-col min-h-0">
      <PrdBriefingRibbon
        stats={stats}
        insumosCount={insumosCount}
        onOpenInsumos={() => setInsumosOpen(true)}
        onApproveAll={handleApproveAll}
        approving={approvingAll}
      />

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(420px,1fr)] gap-6 p-6">
        {/* PRD list (esquerda) */}
        <div className="surface overflow-y-auto min-h-0">
          <h3 className="sticky top-0 z-10 bg-card/95 backdrop-blur text-sm font-semibold px-5 pt-5 pb-3 border-b">
            PRDs ({prds.length})
          </h3>
          <div className="px-5 py-4 space-y-2">
            {prdsLoading ? (
              <p className="text-sm text-muted-foreground">Carregando PRDs…</p>
            ) : prds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum PRD nesta session ainda. Converse com Vitor pra gerar.
              </p>
            ) : (
              prds.map((prd) => (
                <PrdCard key={prd.id} prd={prd} projectId={projectId} />
              ))
            )}
          </div>
        </div>

        {/* Chat Vitor (direita) */}
        <div
          className="min-h-0 surface relative flex flex-col overflow-hidden"
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
                  PDF, DOCX, TXT, MD, HTML, CSV, XLSX
                </p>
              </div>
            </div>
          )}

          <ConversationPanel
            agent="vitor"
            variant="desktop"
            messages={messages}
            status={status}
            input={inputText}
            onInputChange={setInputText}
            onSubmit={handleSend}
            onStop={stop}
            planMode={planMode}
            onPlanModeChange={setPlanMode}
            placeholder="Peça pra Vitor refinar, dividir, consolidar PRDs ou tirar dúvidas…"
            composerLeftActions={composerLeftActions}
            composerAboveSlot={composerAboveSlot}
            composerSubmitDisabled={submitDisabled}
          />
        </div>
      </div>

      <TranscriptModal
        apiUrl={`/api/design-sessions/${sessionId}/transcripts`}
        open={roamModalOpen}
        onOpenChange={setRoamModalOpen}
        onImported={(t) => setTranscripts((cur) => [t, ...cur])}
      />

      <ContextSheet
        open={insumosOpen}
        onOpenChange={setInsumosOpen}
        ritualLabel="PRD"
        linkedItems={linkedItems}
        capabilities={{ transcript: true }}
        handlers={{
          onUnlink: handleUnlinkTranscript,
          onImportTranscript: () => setRoamModalOpen(true),
        }}
      />
    </div>
  );
}
