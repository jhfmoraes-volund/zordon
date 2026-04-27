"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/ui/markdown";
import { VitorBadge } from "./vitor-badge";
import { ToolCallCard } from "./tool-call-card";
import {
  Loader2,
  Bot,
  User,
  Send,
  Paperclip,
  File,
  X,
  Square,
  Sparkles,
} from "lucide-react";

type UploadedFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  extractedText: string;
};

/** Map AI SDK v6 tool states to our ToolCallCard states */
function mapToolState(state: string): "partial-call" | "call" | "result" {
  if (state === "input-streaming") return "partial-call";
  if (state === "input-available") return "call";
  return "result";
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
    (data.files as UploadedFile[]) || []
  );
  const [pendingFiles, setPendingFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [inputText, setInputText] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadIdRef = useRef<string | null>(threadId);
  threadIdRef.current = threadId;

  // Persist files to step data
  const persistState = useCallback(
    (updates: Record<string, unknown>) => {
      onChange({ ...data, ...updates });
    },
    [data, onChange]
  );

  // AI SDK useChat — connected to the agent engine
  // Memoize transport so useChat doesn't reset on every render
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
        },
      }),
    [sessionId]
  );

  const [hasTriggeredFill, setHasTriggeredFill] = useState(false);

  const welcomeText =
    "Olá! Sou o Vitor, seu assistente de design de produto. Me conte sobre o projeto — pode descrever em texto livre ou anexar documentos.\n\nQuando sentir que já tem contexto suficiente, clique no botão para eu preencher os próximos steps.";

  const initialMsg = {
    id: "initial",
    role: "assistant" as const,
    parts: [{ type: "text" as const, text: welcomeText }],
  } as UIMessage;

  const {
    messages,
    status,
    sendMessage,
    stop,
    setMessages,
  } = useChat({
    transport,
    messages: [initialMsg],
    onFinish: () => {
      // Refresh step data after agent may have used tools
      onChange({ ...data });
    },
  });

  const isStreaming = status === "streaming" || status === "submitted";

  // Load existing chat history on mount (and when navigating back)
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/design-sessions/${sessionId}/chat`)
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
                m.role === "user" || m.role === "assistant"
            )
            .map((m: { id: string; role: string; content: string }) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              content: m.content,
              parts: [{ type: "text" as const, text: m.content }],
            }));
          // Prepend welcome message so context is preserved
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

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages, isStreaming]);

  // ─── File upload ─────────────────────────────
  const uploadFiles = useCallback(
    async (fileList: FileList) => {
      setUploading(true);
      const formData = new FormData();
      Array.from(fileList).forEach((f) => formData.append("files", f));

      try {
        const res = await fetch(
          `/api/design-sessions/${sessionId}/upload`,
          { method: "POST", body: formData }
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
    [sessionId, files, persistState]
  );

  const removePendingFile = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
    const updated = files.filter((f) => f.id !== id);
    setFiles(updated);
    persistState({ files: updated });
  };

  // ─── Send message ────────────────────────────
  const handleSend = useCallback(() => {
    if ((!inputText.trim() && !pendingFiles.length) || uploading || isStreaming)
      return;

    // Build message: user text + extracted file text
    let fullMessage = inputText.trim();

    if (pendingFiles.length > 0) {
      const fileTexts = pendingFiles
        .filter((f) => f.extractedText)
        .map(
          (f) =>
            `\n---\nArquivo: ${f.name} (${formatSize(f.size)})\n${f.extractedText}`
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

  // ─── Drag & drop ─────────────────────────────
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length) {
        uploadFiles(e.dataTransfer.files);
      }
    },
    [uploadFiles]
  );

  return (
    <div className="max-w-2xl mx-auto flex flex-col h-[calc(100vh-200px)]">
      {/* Chat container */}
      <div className="surface flex-1 flex flex-col overflow-hidden">
        {/* Scroll area with fade edges */}
        <div className="relative flex-1 min-h-0">
          {/* Top fade */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-card to-transparent" />
          {/* Bottom fade */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-card to-transparent" />

          <div
            ref={scrollRef}
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
            className="h-full overflow-y-auto space-y-4 px-4 py-8 relative scroll-smooth"
          >
            {/* Drop overlay */}
            {isDragging && (
              <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-primary/5 backdrop-blur-sm">
                <div className="text-center">
                  <Paperclip className="h-8 w-8 text-primary mx-auto mb-2" />
                  <p className="text-sm font-medium text-primary">
                    Solte os arquivos aqui
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    PDF, DOCX, TXT, MD
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg, idx) => (
              <MessageBubble key={`${msg.id}-${idx}`} message={msg} />
            ))}

            {uploading && (
              <div className="flex items-center gap-2 text-muted-foreground px-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-xs">Processando arquivos...</span>
              </div>
            )}

            {/* Planning indicator when streaming but no assistant content yet */}
            {isStreaming &&
              messages.length > 0 &&
              messages[messages.length - 1].role === "user" && (
                <div className="flex justify-start">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[5%] px-2.5 py-1">
                    <Sparkles className="h-3 w-3 text-primary animate-pulse" />
                    <span className="shimmer-text text-xs font-medium">
                      Analisando...
                    </span>
                  </div>
                </div>
              )}
          </div>
        </div>

        {/* Fill steps button */}
        {!hasTriggeredFill &&
          !isStreaming &&
          messages.filter((m) => m.role === "user").length >= 1 && (
            <div className="flex justify-center px-4 py-2 border-t border-border/50">
              <Button
                variant="outline"
                className="gap-2 border-primary/30 text-primary hover:bg-primary/5"
                onClick={() => {
                  setHasTriggeredFill(true);
                  sendMessage({
                    text: "Agora preencha todos os steps com base no que conversamos. Preencha product_vision, personas_journeys, brainstorm (com campos ricos: keyScreens, userFlows, painPointRef, technicalNotes), hypotheses e technical_specs. Seja completo.",
                  });
                }}
              >
                <Sparkles className="h-4 w-4" />
                Preencher steps com o que conversamos
              </Button>
            </div>
          )}

        {/* Pending files */}
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 py-2 border-t border-border/50">
            {pendingFiles.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs bg-muted/50"
              >
                <File className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium truncate max-w-[150px]">
                  {f.name}
                </span>
                <button onClick={() => removePendingFile(f.id)}>
                  <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input bar */}
        <div className="flex items-end gap-2 px-4 py-3 border-t border-border/50">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || isStreaming}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Descreva o projeto, cole texto, ou arraste arquivos..."
            rows={1}
            className="resize-none text-sm min-h-[40px] max-h-[120px]"
            disabled={isStreaming}
          />
          {isStreaming ? (
            <Button
              size="icon"
              variant="destructive"
              className="h-10 w-10 shrink-0 animate-pulse"
              onClick={stop}
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-10 w-10 shrink-0"
              disabled={
                (!inputText.trim() && !pendingFiles.length) || uploading
              }
              onClick={handleSend}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Message Bubble ──────────────────────────

function MessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] min-w-0 space-y-2`}>
        {!isUser && <VitorBadge size="sm" />}
        {message.parts.map((part, i) => {
          if (part.type === "text" && part.text) {
            return (
              <div
                key={i}
                className={`rounded-2xl px-4 py-2.5 text-sm overflow-hidden break-words ${
                  isUser
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-muted rounded-tl-sm"
                }`}
              >
                <Markdown>{part.text}</Markdown>
              </div>
            );
          }

          if (part.type.startsWith("tool-")) {
            // AI SDK v6: type is "tool-{name}", properties are flat on the part
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tp = part as any;
            const toolName = tp.toolName ?? part.type.replace(/^tool-/, "");
            return (
              <ToolCallCard
                key={i}
                toolName={toolName}
                args={(tp.input ?? {}) as Record<string, unknown>}
                state={mapToolState(tp.state)}
                result={tp.output}
              />
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
