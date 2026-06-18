"use client";

import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/app-shell";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { ConversationFab } from "@/components/ui/conversation/conversation-fab";
import { ConversationPanel } from "@/components/ui/conversation";
import { useIsMobile } from "@/hooks/use-mobile";
import { readPlanMode, useChatPlanMode } from "@/hooks/use-chat-plan-mode";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { toast } from "sonner";
import { PlanningBoard } from "@/components/planning-session/board";
import { ReleasePlanningRibbon } from "@/components/planning-session/release-planning-ribbon";
import { ReleasePlanningSheet } from "@/components/planning-session/release-planning-sheet";
import { ReleasePlanningContextSheet } from "@/components/planning-session/context-sheet";
import { PrdPicker } from "@/components/planning-session/prd-picker";
import type {
  PlanningSessionRow,
  PlanningSessionPRDWithSource,
} from "@/lib/dal/planning-session";

type SessionWithPrds = PlanningSessionRow & {
  projectName: string | null;
  prds: PlanningSessionPRDWithSource[];
};

export default function PlanningSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);

  const [session, setSession] = useState<SessionWithPrds | null>(null);
  const [loading, setLoading] = useState(true);
  const [orchestrating, setOrchestrating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [prdPickerOpen, setPrdPickerOpen] = useState(false);
  const [insumoCount, setInsumoCount] = useState(0);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [input, setInput] = useState("");

  const threadIdRef = useRef<string | null>(null);
  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  const isMobile = useIsMobile();
  const { planMode, setPlanMode } = useChatPlanMode("vitoria");

  // sessionId estável pro transport/chat — só muda quando troca de session.
  const sessionId = session?.id ?? null;

  // ─── Data loading ────────────────────────────────────────────────────

  const loadSession = useCallback(async () => {
    const listRes = await fetch(`/api/planning-sessions?projectId=${projectId}`);
    if (!listRes.ok) {
      setSession(null);
      return;
    }
    const { sessions } = (await listRes.json()) as { sessions: PlanningSessionRow[] };
    // Singleton: pega a mais recente que não foi abortada.
    const active = sessions.find((s) => s.status !== "aborted");
    if (!active) {
      setSession(null);
      return;
    }
    const getRes = await fetch(`/api/planning-sessions/${active.id}`);
    if (!getRes.ok) {
      setSession(null);
      return;
    }
    const { session: full } = (await getRes.json()) as { session: SessionWithPrds };
    setSession(full);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: spinner durante o load inicial / troca de projeto
    setLoading(true);
    loadSession().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadSession]);

  // ─── Chat ─────────────────────────────────────────────────────────────

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/planning-sessions/${sessionId}/chat`,
        body: {
          get sessionId() {
            return sessionId;
          },
          get threadId() {
            return threadIdRef.current;
          },
          get planMode() {
            return readPlanMode("vitoria");
          },
        },
        fetch: async (url, init) => {
          const res = await fetch(url as RequestInfo, init);
          const tid = res.headers.get("X-Thread-Id");
          if (tid) setThreadId(tid);
          return res;
        },
      }),
    [sessionId],
  );

  // `id` é obrigatório aqui: useChat congela o transport do 1º render (quando
  // sessionId ainda é null) e só recria o Chat quando `id` muda.
  const { messages, status, sendMessage, stop, setMessages } = useChat({
    id: sessionId ?? "release-planning-pending",
    transport,
    onError: (err) => showErrorToast(err, { label: "Vitoria falhou" }),
  });

  // Hidrata histórico do thread + recarrega o board quando o turno termina
  // (Vitoria pode ter mexido nos PRDs via tools).
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if ((prev === "streaming" || prev === "submitted") && status === "ready") {
      void loadSession();
    }
  }, [status, loadSession]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    fetch(`/api/planning-sessions/${sessionId}/chat?limit=50`)
      .then((r) => (r.ok ? r.json() : { threadId: null, messages: [] }))
      .then(
        (result: {
          threadId: string | null;
          messages: Array<{ id: string; role: string; content: string }>;
        }) => {
          if (cancelled) return;
          if (result.threadId) setThreadId(result.threadId);
          const restored = (result.messages ?? [])
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map<UIMessage>((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              parts: [{ type: "text", text: m.content }],
            }));
          if (restored.length > 0) setMessages(restored);
        },
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || status === "streaming" || status === "submitted") return;
    sendMessage({ text });
    setInput("");
  }, [input, status, sendMessage]);

  // Kickoff do ritual: board vazio → pede proposta completa pra Vitoria.
  const handleKickoff = useCallback(() => {
    if (status === "streaming" || status === "submitted") return;
    sendMessage({
      text:
        "Monta uma proposta de release planning: lê os PRDs disponíveis e os insumos " +
        "(linkados e do pool do projeto) e distribui nas sprints, com justificativa por alocação.",
    });
    if (isMobile) setMobileOpen(true);
  }, [status, sendMessage, isMobile]);

  // ─── Actions ────────────────────────────────────────────────────────────

  const handleCreate = useCallback(
    async (cfg: {
      facilitatorId: string | null;
      scheduledFor: string | null;
      sprintCount: number;
    }) => {
      try {
        const res = await fetchOrThrow("/api/planning-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            title: "Release Planning",
            sprintCount: cfg.sprintCount,
            facilitatorId: cfg.facilitatorId,
            scheduledFor: cfg.scheduledFor,
          }),
        });
        await res.json();
        setCreateOpen(false);
        toast.success("Release Planning criado.");
        await loadSession();
      } catch (err) {
        showErrorToast(err, { label: "Falha ao criar Release Planning" });
      }
    },
    [projectId, loadSession],
  );

  const handleOrchestrate = useCallback(() => {
    if (!session) return;
    setConfirmState({
      title: "Gerar plano automático?",
      description:
        "Vitoria vai ler os PRDs do projeto + insumos linkados e montar o board de release sozinha. Pode levar alguns minutos.",
      confirmLabel: "Gerar",
      onConfirm: async () => {
        setOrchestrating(true);
        try {
          await fetchOrThrow(`/api/planning-sessions/${session.id}/orchestrate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetVersion: "v1" }),
          });
          await loadSession();
          toast.success("Plano gerado.");
        } catch (err) {
          showErrorToast(err, { label: "Falha ao gerar plano" });
          await loadSession();
        } finally {
          setOrchestrating(false);
        }
      },
    });
  }, [session, loadSession]);

  const handleApprove = useCallback(() => {
    if (!session) return;
    setConfirmState({
      title: "Aprovar release planning?",
      description:
        "O plano será marcado como aprovado e fica read-only. PRDs de arquivo (cascata) movem de backlog → ready.",
      confirmLabel: "Aprovar",
      onConfirm: async () => {
        setApproving(true);
        try {
          await fetchOrThrow(`/api/planning-sessions/${session.id}/approve`, {
            method: "POST",
          });
          await loadSession();
          toast.success("Release planning aprovado.");
        } catch (err) {
          showErrorToast(err, { label: "Falha ao aprovar" });
        } finally {
          setApproving(false);
        }
      },
    });
  }, [session, loadSession]);

  const handlePrdDrag = useCallback(
    async (prdId: string, sprintStart: number, order: number) => {
      if (!session) return;
      await fetchOrThrow(`/api/planning-sessions/${session.id}/prds/${prdId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sprintStart, order }),
      });
    },
    [session],
  );

  const handleUnlinkPrd = useCallback(
    async (prdRowId: string) => {
      if (!session) return;
      await fetchOrThrow(`/api/planning-sessions/${session.id}/prds/${prdRowId}`, {
        method: "DELETE",
      });
    },
    [session],
  );

  // ─── Render guards ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Carregando release planning…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="space-y-6">
        <PageTitle title="Release Planning" />
        <div className="mx-auto max-w-md rounded-lg border border-dashed p-10 text-center">
          <Sparkles className="mx-auto mb-3 size-8 text-muted-foreground/60" />
          <p className="mb-1 font-medium">Nenhum release planning ativo</p>
          <p className="mb-4 text-sm text-muted-foreground">
            Crie um pra distribuir os PRDs do projeto ao longo das sprints — com a Vitoria ou
            automático.
          </p>
          <Button onClick={() => setCreateOpen(true)}>
            <Sparkles className="size-4" />
            Criar Release Planning
          </Button>
        </div>

        <ReleasePlanningSheet
          open={createOpen}
          onOpenChange={setCreateOpen}
          projectId={projectId}
          onCreate={handleCreate}
        />
      </div>
    );
  }

  const status_ = session.status as
    | "draft"
    | "orchestrating"
    | "in-review"
    | "approved"
    | "aborted"
    | "error";
  const isApproved = status_ === "approved";
  const backHref = `/projects/${projectId}?tab=apps&app=ceremonies`;

  const chatPanel = (
    <ConversationPanel
      agent="vitoria"
      variant={isMobile ? "mobile" : "desktop"}
      messages={messages as UIMessage[]}
      status={status}
      input={input}
      onInputChange={setInput}
      onSubmit={handleSubmit}
      onStop={stop}
      isOpen={mobileOpen}
      onOpenChange={setMobileOpen}
      onClose={isMobile ? () => setMobileOpen(false) : undefined}
      planMode={planMode}
      onPlanModeChange={setPlanMode}
      composerSubmitDisabled={isApproved}
      placeholder={
        isApproved ? "Release planning aprovado — read-only" : undefined
      }
      className="h-full"
    />
  );

  return (
    <div className="-mx-3 -my-4 flex h-[calc(100svh-3rem)] flex-col overflow-hidden sm:-mx-4 md:h-[calc(100svh-3.5rem)] lg:-m-6">
      <PageTitle
        title={session.projectName ?? session.title}
        subtitle={`${session.title} · ${session.sprintCount} sprint${
          session.sprintCount === 1 ? "" : "s"
        }`}
      />

      <ReleasePlanningRibbon
        title={session.title}
        status={status_}
        scheduledFor={session.scheduledFor}
        sprintCount={session.sprintCount}
        prdCount={session.prds.length}
        insumoCount={insumoCount}
        facilitatorName={null}
        backHref={backHref}
        orchestrating={orchestrating}
        approving={approving}
        onOrchestrate={handleOrchestrate}
        onApprove={handleApprove}
        onOpenContext={() => setContextOpen(true)}
        onLinkPrd={() => setPrdPickerOpen(true)}
        onEdit={() => setEditOpen(true)}
      />

      {/* Command center: board de PRDs por sprint (esquerda) + chat Vitoria (direita) */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(380px,1fr)] gap-4 p-4">
        <div className="surface overflow-y-auto min-h-0 p-4">
          {session.prds.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              <p className="mb-4">
                Board vazio. Vincule PRDs, peça pra Vitoria montar, ou clique em
                &ldquo;Gerar plano&rdquo; pra cascata automática.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleKickoff}
                disabled={isApproved || status === "streaming" || status === "submitted"}
              >
                <Sparkles className="size-4" />
                Pedir proposta pra Vitoria
              </Button>
            </div>
          ) : (
            <PlanningBoard
              sessionId={session.id}
              sprintCount={session.sprintCount}
              prds={session.prds}
              onPrdDrag={handlePrdDrag}
              onUnlink={handleUnlinkPrd}
              readOnly={isApproved}
            />
          )}
        </div>

        {!isMobile && <div className="min-h-0">{chatPanel}</div>}
      </div>

      {isMobile && (
        <>
          <ConversationFab
            agent="vitoria"
            isOpen={mobileOpen}
            onClick={() => setMobileOpen(!mobileOpen)}
          />
          {chatPanel}
        </>
      )}

      <ReleasePlanningContextSheet
        sessionId={session.id}
        projectId={projectId}
        open={contextOpen}
        onOpenChange={setContextOpen}
        onCountChange={setInsumoCount}
      />

      <PrdPicker
        sessionId={session.id}
        sprintCount={session.sprintCount}
        open={prdPickerOpen}
        onOpenChange={setPrdPickerOpen}
        onLinked={loadSession}
      />

      <ReleasePlanningSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        projectId={projectId}
        planning={{
          id: session.id,
          facilitatorId: session.facilitatorId,
          scheduledFor: session.scheduledFor,
          sprintCount: session.sprintCount,
          status: session.status,
        }}
        onUpdated={loadSession}
        onDeleted={loadSession}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
