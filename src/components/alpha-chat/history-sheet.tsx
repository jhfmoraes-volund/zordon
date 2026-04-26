"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAlphaChat } from "./store";

type Thread = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
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
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

/**
 * Histórico de threads do Alpha — bottom sheet no mobile, side sheet no
 * desktop. Estrutura segue o padrão do task-sheet:
 *
 *   shrink-0 header  +  flex-1 overflow-y-auto body
 *
 * Lê tudo do store (historyOpen, threadId, loadThread, newConversation).
 * Renderizado no nível do layout (irmão do AlphaChatPanel) pra evitar
 * conflito de focus-trap entre dois Base UI Dialogs aninhados.
 *
 * Selecionar uma thread carrega ela no chat ativo via store.loadThread();
 * "Nova" reseta. Em ambos os casos o sheet fecha — o usuario volta pro
 * chat com o estado novo aplicado.
 */
export function AlphaHistorySheet() {
  const isMobile = useIsMobile();
  const {
    enabled,
    historyOpen,
    setHistoryOpen,
    threadId,
    loadThread,
    newConversation,
  } = useAlphaChat();
  const [threads, setThreads] = useState<Thread[]>([]);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/agents/alpha/threads");
    if (!res.ok) return;
    const data = await res.json();
    setThreads(data.threads ?? []);
  }, []);

  useEffect(() => {
    if (historyOpen) refresh();
  }, [historyOpen, refresh]);

  if (!enabled) return null;

  const handleSelect = async (id: string) => {
    if (id !== threadId) await loadThread(id);
    setHistoryOpen(false);
  };

  const handleNew = () => {
    newConversation();
    setHistoryOpen(false);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Apagar esta conversa?")) return;
    const res = await fetch(`/api/agents/alpha/threads/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) return;
    if (id === threadId) newConversation();
    refresh();
  };

  return (
    <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        showCloseButton={!isMobile}
        // Mobile: bottom sheet 85dvh, drag handle visivel; desktop: side sheet
        // estreito (360px). Ambos: flex-col com header shrink-0 + body scroll.
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile
            ? "data-[side=bottom]:h-[85dvh] rounded-t-xl"
            : "w-full sm:max-w-[360px]",
        )}
      >
        {isMobile && (
          <div
            aria-hidden
            className="absolute top-2 left-1/2 z-10 h-1.5 w-12 -translate-x-1/2 rounded-full bg-muted"
          />
        )}

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b px-4 pt-5 pb-3">
          <h2 className="text-sm font-semibold">Histórico</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNew}
            className="h-7 gap-1.5"
          >
            <Plus className="size-3.5" />
            Nova
          </Button>
        </div>

        {/* Body (scrollable) */}
        <div className="flex-1 overflow-y-auto p-2">
          {threads.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              Nenhuma conversa anterior.
            </p>
          ) : (
            <ul className="space-y-1">
              {threads.map((t) => {
                const isActive = t.id === threadId;
                const title = t.title?.trim() || "Nova conversa";
                return (
                  <li key={t.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelect(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleSelect(t.id);
                        }
                      }}
                      className={cn(
                        "group flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm transition-colors",
                        isActive ? "bg-accent" : "hover:bg-accent/60",
                      )}
                    >
                      <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium leading-tight">
                          {title}
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          {formatRelative(t.updatedAt)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(t.id, e)}
                        className="shrink-0 p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                        aria-label="Apagar conversa"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
