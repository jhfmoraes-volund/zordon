"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useAuth } from "@/contexts/auth-context";
import { hasMinAccessLevel } from "@/lib/roles";
import { buildIngestSeed } from "@/lib/agent/alpha-ingest-seed";

/**
 * Idle threshold: if the bubble is reopened more than this after the last
 * open, the in-memory thread is reset (messages cleared, threadId dropped).
 * Decision lives in the user-facing plan; do not change without alignment.
 */
const IDLE_THRESHOLD_MS = 30 * 60 * 1000;

type AlphaChatValue = {
  /** True when the current member can use Alpha (manager+). */
  enabled: boolean;
  isOpen: boolean;
  toggle: () => void;
  setOpen: (next: boolean) => void;
  messages: UIMessage[];
  isLoading: boolean;
  status: "idle" | "submitted" | "streaming" | "error" | "ready";
  sendMessage: (text: string) => void;
  /**
   * Abre o sheet e dispara a ingestão de uma transcrição externa (Roam ou
   * Granola) em thread nova, com `meetingId` no body (Alpha recebe no
   * `loadContext.params.meetingId`). Usado pelos botões "Importar reunião".
   */
  kickoffIngest: (args: {
    meetingId: string;
    source: "roam" | "granola";
    sourceId: string;
    overwrite: boolean;
    meetingType?: string;
  }) => void;
  /** Current thread ID. null = fresh conversation (next send creates a new one). */
  threadId: string | null;
  /** Load an existing thread's messages into the current chat. */
  loadThread: (id: string) => Promise<void>;
  /** Reset to an empty conversation (clears messages, drops threadId). */
  newConversation: () => void;
  /** Visibility of the history sheet (separate dialog from the chat panel). */
  historyOpen: boolean;
  setHistoryOpen: (next: boolean) => void;
  /** Última resposta veio pelo fallback OpenRouter (daemon offline). */
  isFallback: boolean;
};

const STUB: AlphaChatValue = {
  enabled: false,
  isOpen: false,
  toggle: () => {},
  setOpen: () => {},
  messages: [],
  isLoading: false,
  status: "idle",
  sendMessage: () => {},
  kickoffIngest: () => {},
  threadId: null,
  loadThread: async () => {},
  newConversation: () => {},
  historyOpen: false,
  setHistoryOpen: () => {},
  isFallback: false,
};

/** Convert raw DB messages into UIMessages the AI SDK chat expects. */
function toUIMessages(
  messages: Array<{ id: string; role: string; content: string; parts: unknown }>,
): UIMessage[] {
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

const AlphaChatContext = createContext<AlphaChatValue>(STUB);

export function useAlphaChat(): AlphaChatValue {
  return useContext(AlphaChatContext);
}

export function AlphaChatProvider({ children }: { children: ReactNode }) {
  const { effectiveAccessLevel } = useAuth();
  const enabled = hasMinAccessLevel(effectiveAccessLevel, "manager");
  if (!enabled) return <>{children}</>;
  return <AlphaChatProviderInner>{children}</AlphaChatProviderInner>;
}

function AlphaChatProviderInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [isFallback, setIsFallback] = useState(false);
  const lastOpenedAtRef = useRef<number | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/agents/alpha/chat",
        // Intercept the response to capture the X-Thread-Id header set by the
        // backend when a thread is created or resumed. We only read headers,
        // never consume the body — the SDK still streams normally.
        fetch: async (input, init) => {
          const res = await fetch(input, init);
          const tid = res.headers.get("X-Thread-Id");
          if (tid) setThreadId(tid);
          // Daemon offline → respondeu via OpenRouter. UI mostra tag discreta.
          setIsFallback(res.headers.get("X-Mode-Fallback") === "true");
          return res;
        },
      }),
    [],
  );

  const chat = useChat({ transport });
  const isLoading = chat.status === "streaming" || chat.status === "submitted";

  const toggle = useCallback(() => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    const now = Date.now();
    const last = lastOpenedAtRef.current;
    if (last !== null && now - last >= IDLE_THRESHOLD_MS) {
      // Idle timeout reached: reset to a fresh conversation.
      chat.setMessages([]);
      setThreadId(null);
    }
    lastOpenedAtRef.current = now;
    setIsOpen(true);
  }, [isOpen, chat]);

  const setOpen = useCallback(
    (next: boolean) => {
      if (next === isOpen) return;
      if (next) {
        // Route through toggle so idle-reset logic runs.
        toggle();
      } else {
        setIsOpen(false);
      }
    },
    [isOpen, toggle],
  );

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;
      chat.sendMessage(
        { text: trimmed },
        {
          body: {
            currentPath: pathname,
            threadId,
            newThread: !threadId,
          },
        },
      );
    },
    [chat, isLoading, pathname, threadId],
  );

  const loadThread = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/agents/alpha/chat?threadId=${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setThreadId(id);
      chat.setMessages(toUIMessages(data.messages || []));
      lastOpenedAtRef.current = Date.now();
    },
    [chat],
  );

  const newConversation = useCallback(() => {
    setThreadId(null);
    chat.setMessages([]);
    lastOpenedAtRef.current = Date.now();
  }, [chat]);

  const kickoffIngest = useCallback(
    ({
      meetingId,
      source,
      sourceId,
      overwrite,
      meetingType,
    }: {
      meetingId: string;
      source: "roam" | "granola";
      sourceId: string;
      overwrite: boolean;
      meetingType?: string;
    }) => {
      if (isLoading) return;
      // Abre o sheet, zera estado, dispara thread nova com meetingId no body.
      // Idle-reset não roda aqui (setIsOpen direto) porque já estamos zerando
      // explicitamente — toggle() correria a lógica de timeout sem efeito.
      setIsOpen(true);
      lastOpenedAtRef.current = Date.now();
      setThreadId(null);
      chat.setMessages([]);
      const seed = buildIngestSeed(meetingId, source, sourceId, overwrite, meetingType);
      chat.sendMessage(
        { text: seed },
        {
          body: {
            currentPath: pathname,
            threadId: null,
            newThread: true,
            meetingId,
          },
        },
      );
    },
    [chat, isLoading, pathname],
  );

  const value: AlphaChatValue = {
    enabled: true,
    isOpen,
    toggle,
    setOpen,
    messages: chat.messages,
    isLoading,
    status: chat.status,
    sendMessage,
    kickoffIngest,
    threadId,
    loadThread,
    newConversation,
    historyOpen,
    setHistoryOpen,
    isFallback,
  };

  return <AlphaChatContext.Provider value={value}>{children}</AlphaChatContext.Provider>;
}
