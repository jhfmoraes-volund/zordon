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
import type { ChipTone } from "@/lib/status-chips";
import { ReleasePlanningRibbon } from "@/components/planning-session/release-planning-ribbon";
import { ReleasePlanningSheet } from "@/components/planning-session/release-planning-sheet";
import { ReleasePlanningContextSheet } from "@/components/planning-session/context-sheet";
import { ReleasePlanningProposals } from "@/components/planning-session/release-planning-proposals";
import {
  PlanningCronograma,
  type CronogramaBlock,
} from "@/components/planning-session/planning-cronograma";
import { PlanningHistorySheet } from "@/components/planning-session/planning-history-sheet";
import { PlanningHistoricalCanvas } from "@/components/planning-session/planning-historical-canvas";
import type { PlanningEvent } from "@/components/planning-session/planning-event-log";
import type {
  PlanningSessionRow,
  PlanningSessionPRDWithSource,
} from "@/lib/dal/planning-session";

type SessionWithPrds = PlanningSessionRow & {
  projectName: string | null;
  prds: PlanningSessionPRDWithSource[];
};

/** Key do bloco "Sem sprint" (logs fora de qualquer janela de sprint). */
const NONE_KEY = "__none__";

export default function PlanningSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);

  const [session, setSession] = useState<SessionWithPrds | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [insumoCount, setInsumoCount] = useState(0);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [input, setInput] = useState("");
  // Hidratando o histórico do thread no mount → spinner no corpo do chat.
  const [chatHydrating, setChatHydrating] = useState(true);
  // Bump pra re-fetchar as propostas de task (companion ceremony) quando um turno
  // da Vitoria termina — ela pode ter proposto/editado/descartado tasks via tool.
  const [actionsRefresh, setActionsRefresh] = useState(0);
  // Counts do painel — derivam a fase do header e decidem o empty-state.
  // `planCount` = tasks no board vivo (Fase 2.0); `doneCount` = quantas done.
  const [planState, setPlanState] = useState({
    pendingCount: 0,
    planCount: 0,
    doneCount: 0,
  });
  // Planning Vivo Versionado: versões aplicadas (PlanningEvent) + sprints do
  // projeto alimentam o cronograma de blocos. O canvas só fica "Plano vazio" se
  // NÃO houver board, staging, NEM histórico.
  const [events, setEvents] = useState<PlanningEvent[]>([]);
  const [sprints, setSprints] = useState<
    Array<{ id: string; name: string; startDate: string; endDate: string }>
  >([]);
  const hasPlan =
    planState.pendingCount > 0 || planState.planCount > 0 || events.length > 0;

  // ─── Modo histórico (navegação no cronograma) ──────────────────────────
  // `historyBlockKey` = bloco/semana selecionada (sprintId ou "__none__");
  // `historyEventId` = versão aberta no canvas. Em modo histórico, canvas + chat
  // ficam read-only.
  const [historyBlockKey, setHistoryBlockKey] = useState<string | null>(null);
  const [historyEventId, setHistoryEventId] = useState<string | null>(null);
  // Sheet do navegador de versões. Separado do historyMode: fechar o sheet NÃO
  // sai do histórico (o canvas segue congelado pra você vê-lo); reabrir = clicar
  // um bloco na mini-régua. Sair de vez é o "Ao vivo".
  const [historySheetOpen, setHistorySheetOpen] = useState(false);
  const historyMode = historyBlockKey !== null;

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
    setLoading(true);
    loadSession().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadSession]);

  // Sprints do projeto → blocos do cronograma. status=all inclui as futuras.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sprints?projectId=${projectId}&status=all`)
      .then((r) => (r.ok ? r.json() : []))
      .then(
        (rows: Array<{ id: string; name: string; startDate: string; endDate: string }>) => {
          if (!cancelled) setSprints(rows ?? []);
        },
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Versões aplicadas (PlanningEvent) — alimentam o cronograma + a drawer.
  // Refetcha após cada "Aplicar" (actionsRefresh bump).
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    fetch(`/api/planning-sessions/${sessionId}/events`)
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((data: { events: PlanningEvent[] }) => {
        if (!cancelled) setEvents(data.events ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId, actionsRefresh]);

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
        // resumeStream() reconecta a um turn em vôo. O turn é resolvido
        // server-side a partir do thread — sem id do cliente.
        prepareReconnectToStreamRequest: () => ({
          api: `/api/planning-sessions/${sessionId}/chat/resume`,
        }),
      }),
    [sessionId],
  );

  // `id` é obrigatório aqui: useChat congela o transport do 1º render (quando
  // sessionId ainda é null) e só recria o Chat quando `id` muda.
  const { messages, status, sendMessage, stop, setMessages, resumeStream } =
    useChat({
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
      setActionsRefresh((n) => n + 1);
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
          activeTurn?: { id: string; status: string } | null;
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
          // Geração em andamento no background → reconecta ao stream pra a UI
          // voltar a "pensar" de onde parou (replay + tail do ChatTurnEvent).
          if (result.activeTurn) {
            void resumeStream();
          }
        },
      )
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChatHydrating(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ─── Cronograma: blocos por sprint + binagem dos logs por janela de data ──
  const { blocks, eventsByBlock } = useMemo(() => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const sorted = [...sprints].sort((a, b) => a.startDate.localeCompare(b.startDate));

    // Bina cada versão na sprint cuja janela [startDate, endDate] contém o
    // createdAt (D1). Fora de qualquer janela → bucket NONE.
    const byBlock = new Map<string, PlanningEvent[]>();
    for (const ev of events) {
      const d = ev.createdAt.slice(0, 10);
      const sprint = sorted.find((s) => s.startDate <= d && d <= s.endDate);
      const key = sprint?.id ?? NONE_KEY;
      const arr = byBlock.get(key);
      if (arr) arr.push(ev);
      else byBlock.set(key, [ev]);
    }

    const list: CronogramaBlock[] = sorted.map((s) => ({
      sprintId: s.id,
      sprintName: s.name,
      dateLabel: `${s.startDate.slice(8, 10)}/${s.startDate.slice(5, 7)}`,
      kind: today < s.startDate ? "future" : today > s.endDate ? "past" : "current",
      logCount: byBlock.get(s.id)?.length ?? 0,
    }));
    // Bloco trailing pros logs fora de qualquer janela (raro).
    const orphan = byBlock.get(NONE_KEY)?.length ?? 0;
    if (orphan > 0) {
      list.push({
        sprintId: null,
        sprintName: "Sem sprint",
        dateLabel: "—",
        kind: "past",
        logCount: orphan,
      });
    }
    return { blocks: list, eventsByBlock: byBlock };
  }, [sprints, events]);

  const exitHistory = useCallback(() => {
    setHistoryBlockKey(null);
    setHistoryEventId(null);
    setHistorySheetOpen(false);
  }, []);

  // Click num bloco (mini-régua OU cronograma do sheet): seleciona a semana,
  // auto-abre a versão mais recente dela (API ordena desc) e abre o navegador.
  // Sair do histórico é só pelo "Ao vivo".
  const handleSelectBlock = useCallback(
    (sprintId: string | null) => {
      const key = sprintId ?? NONE_KEY;
      setHistoryBlockKey(key);
      const bucket = eventsByBlock.get(key) ?? [];
      setHistoryEventId(bucket[0]?.id ?? null);
      setHistorySheetOpen(true);
    },
    [eventsByBlock],
  );

  // Eventos + rótulo do bloco selecionado (alimentam o sheet).
  const drawerEvents = historyBlockKey ? eventsByBlock.get(historyBlockKey) ?? [] : [];
  const selectedBlockLabel =
    blocks.find((b) => (b.sprintId ?? NONE_KEY) === historyBlockKey)?.sprintName ?? null;

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || historyMode || status === "streaming" || status === "submitted") return;
    sendMessage({ text });
    setInput("");
  }, [input, historyMode, status, sendMessage]);

  // "Montar plano": pede pra Vitoria ler as FONTES (insumos + PRDs) e propor
  // as tasks/stories distribuídas nas sprints. É o atalho de 1 clique do kickoff/
  // backfill — depois o PM revisa no painel e aplica.
  const handleKickoff = useCallback(() => {
    if (historyMode || status === "streaming" || status === "submitted") return;
    sendMessage({
      text:
        "Monta o plano: lê as fontes do projeto (insumos linkados + PRDs disponíveis) e " +
        "propõe as tasks/stories distribuídas nas sprints, com justificativa. " +
        "Use propose_tasks em lote quando derivar várias de uma fonte. " +
        "Se o projeto já tem board, leia list_project_tasks antes e construa sobre ele: " +
        "referencie o taskId pra mover/editar o que já existe, só crie o que é novo " +
        "(não recrie — duplicata é pulada no Aplicar).",
    });
    if (isMobile) setMobileOpen(true);
  }, [historyMode, status, sendMessage, isMobile]);

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
        // Singleton: o backend faz resolve-or-create. `existed` = já havia uma
        // ativa, então só abrimos a existente (info, não "criado").
        const { existed } = (await res.json()) as { existed?: boolean };
        setCreateOpen(false);
        if (existed) {
          toast.info("Já existe um Release Planning ativo — abrindo o existente.");
        } else {
          toast.success("Release Planning criado.");
        }
        await loadSession();
      } catch (err) {
        showErrorToast(err, { label: "Falha ao criar Release Planning" });
      }
    },
    [projectId, loadSession],
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
  const busy = status === "streaming" || status === "submitted";
  const backHref = `/projects/${projectId}?tab=apps&app=ceremonies`;

  // Fase DERIVADA do header (planner vivo): o status persistido só modela casos
  // terminais legados (approved/aborted/error); a fase do dia-a-dia vem dos counts
  // do painel — staging (tem pendente) → com plano (board vivo tem task) → rascunho.
  const phase: { label: string; tone: ChipTone } =
    status_ === "aborted"
      ? { label: "Abortado", tone: "red" }
      : status_ === "error"
        ? { label: "Erro", tone: "red" }
        : status_ === "approved"
          ? { label: "Aprovado", tone: "green" }
          : planState.pendingCount > 0
            ? { label: "Em staging", tone: "blue" }
            : planState.planCount > 0
              ? { label: "Com plano", tone: "green" }
              : { label: "Rascunho", tone: "blue" };

  // Em modo histórico a conversa é a thread inteira, mas o composer trava — não
  // dá pra interagir com a Vitoria "no passado" (mesmo padrão do isApproved).
  const chatReadOnly = isApproved || historyMode;
  const chatPanel = (
    <ConversationPanel
      agent="vitoria"
      variant={isMobile ? "mobile" : "desktop"}
      messages={messages as UIMessage[]}
      status={status}
      isLoading={chatHydrating}
      input={input}
      onInputChange={setInput}
      onSubmit={handleSubmit}
      onStop={stop}
      isOpen={mobileOpen}
      onOpenChange={setMobileOpen}
      onClose={isMobile ? () => setMobileOpen(false) : undefined}
      planMode={planMode}
      onPlanModeChange={setPlanMode}
      composerSubmitDisabled={chatReadOnly}
      placeholder={
        historyMode
          ? "Histórico — read-only (não dá pra interagir com a Vitoria)"
          : isApproved
            ? "Release planning aprovado — read-only"
            : undefined
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
        phaseLabel={phase.label}
        phaseTone={phase.tone}
        scheduledFor={session.scheduledFor}
        sprintCount={session.sprintCount}
        pendingCount={planState.pendingCount}
        planCount={planState.planCount}
        doneCount={planState.doneCount}
        insumoCount={insumoCount}
        backHref={backHref}
        busy={busy}
        readOnly={isApproved}
        historyMode={historyMode}
        onMontar={handleKickoff}
        onOpenContext={() => setContextOpen(true)}
        onEdit={() => setEditOpen(true)}
        onExitHistory={exitHistory}
      />

      {/* Mini-régua sempre visível no ribbon — glance + entrada. Click num bloco
          abre o side-sheet (PlanningHistorySheet) e entra no modo histórico. */}
      {blocks.length > 0 && (
        <div className="shrink-0 border-b bg-background px-6 py-2 flex items-center gap-3">
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Histórico
          </span>
          <PlanningCronograma
            variant="mini"
            blocks={blocks}
            selectedKey={historyBlockKey}
            onSelect={handleSelectBlock}
          />
        </div>
      )}

      {/* Canvas: plano (tasks/stories por sprint) à esquerda + chat Vitoria à direita.
          PRD↔sprint board saiu (2026-06-19) — a planning lê fontes e produz tasks. */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(380px,1fr)] gap-4 p-4">
        <div className="surface overflow-y-auto min-h-0 p-4 space-y-4">
          {historyMode ? (
            // Canvas HISTÓRICO (read-only) da versão selecionada. Sem versão na
            // semana → estado vazio (bloco passado sem atividade).
            historyEventId ? (
              <PlanningHistoricalCanvas sessionId={session.id} eventId={historyEventId} />
            ) : (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Nenhuma versão do plano nesta semana.
              </div>
            )
          ) : (
            <>
              <ReleasePlanningProposals
                planningCeremonyId={session.planningCeremonyId}
                projectId={projectId}
                refreshKey={actionsRefresh}
                readOnly={isApproved}
                onStateChange={setPlanState}
                onApplied={() => {
                  void loadSession();
                  setActionsRefresh((n) => n + 1);
                }}
              />
              {!hasPlan && (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  <p className="mb-4">
                    Plano vazio. Peça pra Vitoria montar a partir das fontes (insumos +
                    PRDs) — ela propõe as tasks por sprint, você revisa e aplica.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleKickoff}
                    disabled={isApproved || busy}
                  >
                    <Sparkles className="size-4" />
                    Montar plano
                  </Button>
                </div>
              )}
            </>
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

      {/* Navegador de versões (side-sheet). Fechar NÃO sai do histórico — o
          canvas segue congelado; reabrir = clicar um bloco na mini-régua. */}
      <PlanningHistorySheet
        open={historySheetOpen}
        onOpenChange={setHistorySheetOpen}
        blocks={blocks}
        selectedKey={historyBlockKey}
        onSelectBlock={handleSelectBlock}
        weekLabel={selectedBlockLabel}
        events={drawerEvents}
        selectedEventId={historyEventId}
        onSelectEvent={setHistoryEventId}
      />

      <ReleasePlanningContextSheet
        sessionId={session.id}
        projectId={projectId}
        open={contextOpen}
        onOpenChange={setContextOpen}
        onCountChange={setInsumoCount}
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
