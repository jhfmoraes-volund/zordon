"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { History, MessageSquare, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AgentBadge,
  ConversationPanel,
} from "@/components/ui/conversation";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { fmtDateNumeric } from "@/lib/date-utils";
import { buildIngestSeed } from "@/lib/agent/alpha-ingest-seed";
import {
  ConfirmDialog,
  type ConfirmState,
} from "@/components/ui/confirm-dialog";

type Thread = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

type StoredMessage = {
  id: string;
  role: string;
  content: string;
  parts: unknown;
};

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `${diffMin}min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d`;
  return fmtDateNumeric(iso);
}

function toUIMessages(messages: StoredMessage[]): UIMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const storedParts = Array.isArray(m.parts)
        ? (m.parts as UIMessage["parts"])
        : null;
      return {
        id: m.id,
        role: m.role as "user" | "assistant",
        parts:
          storedParts && storedParts.length > 0
            ? storedParts
            : [{ type: "text" as const, text: m.content }],
      };
    });
}

export default function OpsPage() {
  const isMobile = useIsMobile();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [forceNewThread, setForceNewThread] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const kickoffFiredRef = useRef(false);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/agents/alpha/chat" }),
    [],
  );

  const refreshThreads = useCallback(async (adoptLatestIfMissing = false) => {
    const res = await fetch("/api/agents/alpha/threads");
    if (!res.ok) return;
    const data = await res.json();
    const list: Thread[] = data.threads || [];
    setThreads(list);
    if (adoptLatestIfMissing) {
      setThreadId((cur) => cur ?? list[0]?.id ?? null);
    }
  }, []);

  const chat = useChat({
    transport,
    onFinish: () => {
      setForceNewThread(false);
      refreshThreads(true);
    },
  });
  const isLoading =
    chat.status === "streaming" || chat.status === "submitted";

  useEffect(() => {
    refreshThreads();

    // Kickoff de ingestão de reunião (chega via /ops?kickoff=ingest&...).
    // Forçamos thread nova + seed prompt e o Alpha trabalha sozinho. Limpa a
    // URL pra não disparar de novo em refresh/back. Guard ref garante uma vez.
    //
    // Aceita o formato novo (`source` + `sourceId`) e o legado
    // (`roamTranscriptId`) pra não quebrar bookmarks/links existentes.
    const kickoff = searchParams.get("kickoff");
    const meetingId = searchParams.get("meetingId");
    const overwrite = searchParams.get("overwrite") === "1";
    const sourceParam = searchParams.get("source");
    const sourceIdParam = searchParams.get("sourceId");
    const legacyRoamId = searchParams.get("roamTranscriptId");
    const source: "roam" | "granola" | null =
      sourceParam === "roam" || sourceParam === "granola"
        ? sourceParam
        : legacyRoamId
          ? "roam"
          : null;
    const sourceId = sourceIdParam ?? legacyRoamId;

    if (
      kickoff === "ingest" &&
      meetingId &&
      source &&
      sourceId &&
      !kickoffFiredRef.current
    ) {
      kickoffFiredRef.current = true;
      const seed = buildIngestSeed(meetingId, source, sourceId, overwrite);
      setThreadId(null);
      setForceNewThread(true);
      chat.setMessages([]);
      chat.sendMessage(
        { text: seed },
        { body: { threadId: null, newThread: true, meetingId } },
      );
      router.replace("/ops");
      return;
    }

    fetch("/api/agents/alpha/chat")
      .then((r) => r.json())
      .then((data) => {
        if (data.threadId) setThreadId(data.threadId);
        if (data.messages?.length) chat.setMessages(toUIMessages(data.messages));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    chat.sendMessage(
      { text },
      { body: { threadId, newThread: forceNewThread } },
    );
  }, [chat, input, isLoading, threadId, forceNewThread]);

  const handleNewConversation = () => {
    if (isLoading) return;
    setThreadId(null);
    setForceNewThread(true);
    chat.setMessages([]);
    setHistoryOpen(false);
  };

  const handleSelectThread = async (id: string) => {
    if (id === threadId || isLoading) return;
    const res = await fetch(`/api/agents/alpha/chat?threadId=${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setForceNewThread(false);
    setThreadId(id);
    chat.setMessages(toUIMessages(data.messages || []));
    setHistoryOpen(false);
  };

  const handleDeleteThread = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmState({
      title: "Apagar esta conversa?",
      confirmLabel: "Apagar",
      destructive: true,
      onConfirm: async () => {
        const snapshot = threads;
        setThreads((prev) => prev.filter((t) => t.id !== id));
        if (id === threadId) {
          setThreadId(null);
          chat.setMessages([]);
        }
        try {
          await fetchOrThrow(`/api/agents/alpha/threads/${id}`, {
            method: "DELETE",
          });
        } catch (err) {
          setThreads(snapshot);
          showErrorToast(err, { label: "Falha ao apagar conversa" });
        }
      },
    });
  };

  const renderThreadsList = () => (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b p-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleNewConversation}
          disabled={isLoading}
        >
          <Plus className="h-4 w-4" />
          Nova conversa
        </Button>
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {threads.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Nenhuma conversa anterior.
          </p>
        ) : (
          threads.map((t) => {
            const isActive = t.id === threadId;
            const title = t.title?.trim() || "Nova conversa";
            return (
              <div
                key={t.id}
                onClick={() => handleSelectThread(t.id)}
                className={`group flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm ${
                  isActive ? "border bg-background" : "hover:bg-background/60"
                }`}
              >
                <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium leading-tight">
                    {title}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {formatRelative(t.updatedAt)}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDeleteThread(t.id, e)}
                  className="shrink-0 p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                  aria-label="Apagar conversa"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="-mx-3 -my-4 flex h-[calc(100svh-3rem)] min-h-0 flex-col sm:-mx-4 md:h-[calc(100svh-3.5rem)] lg:-m-6">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2 md:hidden">
        <AgentBadge agent="alpha" size="sm" />
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => setHistoryOpen(true)}
        >
          <History className="h-4 w-4" />
          Histórico
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <ConversationPanel
            agent="alpha"
            variant="fullpage"
            messages={chat.messages}
            status={chat.status}
            input={input}
            onInputChange={setInput}
            onSubmit={handleSubmit}
            placeholder="Pergunte sobre o sprint, alocação ou crie tasks..."
          />
        </div>

        <aside className="hidden w-72 shrink-0 flex-col border-l bg-muted/40 md:flex">
          {renderThreadsList()}
        </aside>
      </div>

      {isMobile && (
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetContent
            side="right"
            className="w-[85vw] max-w-sm bg-muted/20 p-0"
          >
            {renderThreadsList()}
          </SheetContent>
        </Sheet>
      )}
      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
