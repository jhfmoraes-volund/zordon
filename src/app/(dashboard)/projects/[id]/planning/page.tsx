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
import { Check, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageTitle } from "@/components/app-shell";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { ConversationFab } from "@/components/ui/conversation/conversation-fab";
import { ConversationPanel } from "@/components/ui/conversation";
import { AgentSplit, CanvasStage } from "@/components/ui/canvas";
import { cn } from "@/lib/utils";
import { useIsMobile, XL_BREAKPOINT } from "@/hooks/use-mobile";
import { readPlanMode, useChatPlanMode } from "@/hooks/use-chat-plan-mode";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { toast } from "sonner";
import type { ChipTone } from "@/lib/status-chips";
import { ReleasePlanningRibbon } from "@/components/planning-session/release-planning-ribbon";
import { ReleasePlanningSheet } from "@/components/planning-session/release-planning-sheet";
import { ReleasePlanningContextSheet } from "@/components/planning-session/context-sheet";
import { ReleasePlanningProposals } from "@/components/planning-session/release-planning-proposals";
import { ReleasePlanningStories } from "@/components/planning-session/release-planning-stories";
import { StoryDetailSheet } from "@/components/planning-session/story-detail-sheet";
import {
  CronogramaRail,
  type CronogramaBlock,
} from "@/components/timeline/cronograma";
import { PlanningHistorySheet } from "@/components/planning-session/planning-history-sheet";
import { PlanningHistoricalCanvas } from "@/components/planning-session/planning-historical-canvas";
import { fmtDayMonth } from "@/lib/date-utils";
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

/** "Sprint 12" → "12" (indicador curto do chip); resto inalterado. */
function shortName(name: string): string {
  const m = /^Sprint\s+(.+)$/i.exec(name);
  return m ? m[1] : name;
}

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
  // Lente do canvas: board de tasks por sprint OU todas as user stories (por
  // módulo, sem sprint). Toggle vive na toolbar do canvas.
  const [view, setView] = useState<"tasks" | "stories">("tasks");
  const [storyCount, setStoryCount] = useState(0);
  // Story aberta no side sheet de detalhe (vista User Stories).
  const [openStoryRef, setOpenStoryRef] = useState<string | null>(null);
  // Smart-refresh: a Vitoria mexe no board via tools; em vez de recarregar a
  // cada turno (reordena sob o usuário), sinalizamos "novo conteúdo" e o usuário
  // puxa pelo ⟳. Auto-pull só quando o board está vazio (nada a atrapalhar).
  const [hasNewContent, setHasNewContent] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
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
  // Deep-link `?sprint=<id>` (cronograma do Finanças) → abre já em modo histórico
  // naquela sprint. Lido 1× no mount (SSR-safe, sem useSearchParams/Suspense) e
  // semeado no ESTADO INICIAL (sem setState-in-effect). A versão exibida cai na
  // mais recente do bloco via `effectiveHistoryEventId` (derivada no render).
  const [initialSprintParam] = useState<string | null>(() =>
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("sprint")
      : null,
  );
  const [historyBlockKey, setHistoryBlockKey] = useState<string | null>(initialSprintParam);
  const [historyEventId, setHistoryEventId] = useState<string | null>(null);
  // Sheet do navegador de versões. Separado do historyMode: fechar o sheet NÃO
  // sai do histórico (o canvas segue congelado pra você vê-lo); reabrir = clicar
  // um bloco na mini-régua. Sair de vez é o "Ao vivo".
  const [historySheetOpen, setHistorySheetOpen] = useState(!!initialSprintParam);
  const historyMode = historyBlockKey !== null;

  const threadIdRef = useRef<string | null>(null);
  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  // Abaixo de xl (1280px) o split canvas+chat não cabe → chat vira drawer
  // (FAB + bottom sheet), igual mobile. Evita empilhar 2 painéis desktop.
  const chatAsDrawer = useIsMobile(XL_BREAKPOINT);
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
  // useCallback pra o sheet poder re-disparar após gerar "Sprints do prazo".
  const loadSprints = useCallback(async () => {
    try {
      const r = await fetch(`/api/sprints?projectId=${projectId}&status=all`);
      const rows = r.ok
        ? ((await r.json()) as Array<{
            id: string;
            name: string;
            startDate: string;
            endDate: string;
          }>)
        : [];
      setSprints(rows ?? []);
    } catch {
      // silencioso — cronograma apenas não renderiza
    }
  }, [projectId]);

  useEffect(() => {
    void loadSprints();
  }, [loadSprints]);

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

  // Smart-refresh: quando o turno termina, a Vitoria pode ter mexido no board
  // via tools. Recarregar na cara reordena sob o usuário (perde scroll/colapso/
  // descartes). Então: recarrega só a SESSÃO (meta, barato, não toca o board) e
  // — se o board está vazio (nada a atrapalhar) — puxa direto; senão sinaliza
  // "novo conteúdo" e o usuário recarrega pelo ⟳ quando quiser.
  // Espelha "board vazio" num ref (atualizado fora do render) pra o efeito de
  // fim-de-turno não precisar depender de planState — depender de state + setState
  // no mesmo efeito dispara o alerta de cascata.
  const boardEmptyRef = useRef(true);
  useEffect(() => {
    boardEmptyRef.current =
      planState.planCount === 0 && planState.pendingCount === 0;
  }, [planState.planCount, planState.pendingCount]);

  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if ((prev === "streaming" || prev === "submitted") && status === "ready") {
      void loadSession();
      if (boardEmptyRef.current) setActionsRefresh((n) => n + 1);
      else setHasNewContent(true);
    }
  }, [status, loadSession]);

  // Abrir/refresh REIDRATA a conversa em andamento — NÃO zera. O chat de uma
  // versão do plano persiste enquanto ela está sendo montada: dar refresh ou
  // reabrir continua de onde parou (papo + propostas em staging). O reset pra um
  // "agente limpo" acontece só ao APLICAR um batch (handleApplied → POST
  // /chat/new): aí a thread anterior vira histórico e a próxima versão começa
  // limpa. Um simples refresh nunca reseta. O canvas (board vivo/AS-IS) é
  // independente da thread.
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
      key: s.id,
      label: s.name,
      indicator: shortName(s.name),
      dateLabel: fmtDayMonth(s.startDate),
      kind: today < s.startDate ? "future" : today > s.endDate ? "past" : "current",
      logCount: byBlock.get(s.id)?.length ?? 0,
    }));
    // Bloco trailing pros logs fora de qualquer janela (raro).
    const orphan = byBlock.get(NONE_KEY)?.length ?? 0;
    if (orphan > 0) {
      list.push({
        key: NONE_KEY,
        label: "Sem sprint",
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

  // Pós-aplicar uma versão do plano (Planning vivo versionado): a versão foi
  // commitada → (1) volta pro "ao vivo", (2) abre um CHAT NOVO com a Vitoria pra
  // a próxima iteração (o anterior vira histórico), (3) recarrega o canvas no
  // estado vivo (staging consumido → tasks reais no board, ao lado do chat novo).
  const handleApplied = useCallback(
    async (result: { applied: number; failed: number; skipped: number }) => {
      exitHistory();
      // Vira pro chat novo (próxima versão) só num apply LIMPO (aplicou algo E sem
      // falhas). Apply parcial/falho PRESERVA o papo — a companion fica viva com as
      // falhas retentáveis no staging, e é aí que o PM precisa do contexto pra pedir
      // "Vitoria, conserta isso" (achados #2 + #3).
      if (sessionId && result.applied > 0 && result.failed === 0) {
        try {
          const res = await fetchOrThrow(
            `/api/planning-sessions/${sessionId}/chat/new`,
            { method: "POST" },
          );
          const { threadId: fresh } = (await res.json()) as { threadId: string };
          setMessages([]);
          setThreadId(fresh);
        } catch {
          // Best-effort: se o chat novo falhar, o anterior segue e o board ainda
          // atualiza — não trava o fluxo de aplicar.
        }
      }
      void loadSession();
      setActionsRefresh((n) => n + 1);
    },
    [sessionId, exitHistory, loadSession, setMessages],
  );

  // "Aplicar" agora mora na toolbar do canvas (página), não no board. Conclui a
  // companion ceremony → propostas viram tasks reais (auto-aprova + cascata).
  const handleApplyBoard = useCallback(() => {
    const ceremonyId = session?.planningCeremonyId ?? null;
    const agentBusy = status === "streaming" || status === "submitted";
    if (!ceremonyId || planState.pendingCount === 0 || agentBusy) return;
    setConfirmState({
      title: `Aplicar ${planState.pendingCount} proposta${planState.pendingCount === 1 ? "" : "s"}?`,
      description:
        "As propostas não-descartadas viram Tasks de verdade (com PFV, sprint e — no backfill — já concluídas). As descartadas são ignoradas. Você pode re-planejar a qualquer momento — o board vivo é a base.",
      confirmLabel: "Aplicar",
      onConfirm: async () => {
        setApplyBusy(true);
        try {
          const res = await fetchOrThrow(
            `/api/planning/${ceremonyId}/complete`,
            { method: "POST" },
            { timeoutMs: 90_000 },
          );
          const result = (await res.json()) as {
            applied?: { applied?: number; failed?: number; skipped?: number };
          };
          const applied = result.applied?.applied ?? 0;
          const failed = result.applied?.failed ?? 0;
          const skipped = result.applied?.skipped ?? 0;
          // Mostra TODAS as contagens — propostas puladas (duplicata) somem da
          // tela sem explicação e o PM acha que bugou.
          const parts = [`${applied} aplicada${applied === 1 ? "" : "s"}`];
          if (skipped) parts.push(`${skipped} pulada${skipped === 1 ? "" : "s"} (trabalho em curso ou duplicata)`);
          if (failed) parts.push(`${failed} falhou`);
          const msg = parts.join(" · ");
          if (failed && !applied) toast.error(msg);
          else if (skipped || failed) toast.warning(msg);
          else toast.success(msg);
          await handleApplied({ applied, failed, skipped });
        } catch (err) {
          showErrorToast(err, { label: "Falha ao aplicar propostas" });
        } finally {
          setApplyBusy(false);
        }
      },
    });
  }, [session?.planningCeremonyId, planState.pendingCount, status, handleApplied]);

  // ⟳ recarrega o canvas (board + stories) sob comando do usuário e limpa o
  // indicador de "novo conteúdo" do smart-refresh.
  const handleRefreshCanvas = useCallback(() => {
    setActionsRefresh((n) => n + 1);
    setHasNewContent(false);
  }, []);

  // Click num bloco (mini-régua OU cronograma do sheet): seleciona a semana,
  // auto-abre a versão mais recente dela (API ordena desc) e abre o navegador.
  // Sair do histórico é só pelo "Ao vivo".
  const handleSelectBlock = useCallback(
    (key: string) => {
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
    blocks.find((b) => b.key === historyBlockKey)?.label ?? null;
  // Versão efetiva exibida: a escolhida pelo usuário, senão a mais recente do
  // bloco (deep-link `?sprint=` cai direto na última versão, sem clique extra).
  const effectiveHistoryEventId =
    historyEventId ?? (historyBlockKey ? eventsByBlock.get(historyBlockKey)?.[0]?.id ?? null : null);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || historyMode || status === "streaming" || status === "submitted") return;
    sendMessage({ text });
    setInput("");
  }, [input, historyMode, status, sendMessage]);

  // "Montar plano": pede pra Vitoria ler as FONTES (insumos + PRDs) e propor
  // as tasks/stories distribuídas nas sprints. É o atalho de 1 clique do kickoff/
  // backfill — depois o PM revisa no painel e aplica.
  const runKickoff = useCallback(() => {
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
    if (chatAsDrawer) setMobileOpen(true);
  }, [historyMode, status, sendMessage, chatAsDrawer]);

  // Guards do "Montar plano": (#7) sem fontes linkadas a Vitoria parte do zero e
  // pode inventar tasks; (#6) com staging pendente, montar de novo empilha por
  // cima em vez de aplicar primeiro. Confirma antes em vez de bloquear.
  const handleKickoff = useCallback(() => {
    if (historyMode || status === "streaming" || status === "submitted") return;
    const noSources = insumoCount === 0 && (session?.prds.length ?? 0) === 0;
    const hasStaging = planState.pendingCount > 0;
    if (noSources || hasStaging) {
      const reasons = [
        noSources &&
          "Não há fonte linkada (insumo ou PRD) — a Vitoria parte do zero e pode inventar tasks.",
        hasStaging &&
          `Já há ${planState.pendingCount} proposta${planState.pendingCount === 1 ? "" : "s"} em staging — montar de novo adiciona mais por cima (considere aplicar primeiro).`,
      ]
        .filter(Boolean)
        .join(" ");
      setConfirmState({
        title: "Montar o plano mesmo assim?",
        description: reasons,
        confirmLabel: "Montar mesmo assim",
        onConfirm: () => runKickoff(),
      });
      return;
    }
    runKickoff();
  }, [historyMode, status, insumoCount, session, planState.pendingCount, runKickoff]);

  // ─── Actions ────────────────────────────────────────────────────────────

  const handleCreate = useCallback(
    async (cfg: { facilitatorId: string | null }) => {
      try {
        const res = await fetchOrThrow("/api/planning-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            title: "Planning",
            facilitatorId: cfg.facilitatorId,
          }),
        });
        // Singleton: o backend faz resolve-or-create. `existed` = já havia uma
        // ativa, então só abrimos a existente (info, não "criado").
        const { existed } = (await res.json()) as { existed?: boolean };
        setCreateOpen(false);
        if (existed) {
          toast.info("Já existe um Planning ativo — abrindo o existente.");
        } else {
          toast.success("Planning criado.");
        }
        await loadSession();
      } catch (err) {
        showErrorToast(err, { label: "Falha ao criar Planning" });
      }
    },
    [projectId, loadSession],
  );

  // ─── Render guards ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Carregando planning…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="space-y-6">
        <PageTitle title="Planning" />
        <div className="mx-auto max-w-md rounded-lg border border-dashed p-10 text-center">
          <Sparkles className="mx-auto mb-3 size-8 text-muted-foreground/60" />
          <p className="mb-1 font-medium">Nenhum planning ativo</p>
          <p className="mb-4 text-sm text-muted-foreground">
            Crie pra planejar o trabalho do projeto ao longo das sprints — a Vitoria lê as
            fontes (PRDs + insumos) e propõe as tasks. Um planejamento contínuo, evolui a
            qualquer momento.
          </p>
          <Button onClick={() => setCreateOpen(true)}>
            <Sparkles className="size-4" />
            Criar Planning
          </Button>
        </div>

        <ReleasePlanningSheet
          open={createOpen}
          onOpenChange={setCreateOpen}
          projectId={projectId}
          onCreate={handleCreate}
          onSprintsGenerated={loadSprints}
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
      variant={chatAsDrawer ? "mobile" : "desktop"}
      messages={messages as UIMessage[]}
      status={status}
      isLoading={chatHydrating}
      input={input}
      onInputChange={setInput}
      onSubmit={handleSubmit}
      onStop={stop}
      isOpen={mobileOpen}
      onOpenChange={setMobileOpen}
      onClose={chatAsDrawer ? () => setMobileOpen(false) : undefined}
      planMode={planMode}
      onPlanModeChange={setPlanMode}
      composerSubmitDisabled={chatReadOnly}
      placeholder={
        historyMode
          ? "Histórico — read-only (não dá pra interagir com a Vitoria)"
          : isApproved
            ? "Planning aprovado — read-only"
            : undefined
      }
      className={cn(
        "h-full",
        // No desktop o chat fica flush dentro do rail (.canvas-rail) — sem card
        // próprio competindo com a mesa. No drawer mantém o sheet.
        !chatAsDrawer && "rounded-none border-0 bg-transparent shadow-none",
      )}
    />
  );

  // Toolbar do canvas (header fixo na mesa, acima da folha): título + count,
  // toggle Tasks⇄User Stories, ⟳ refresh (acende com "novo") e Aplicar (só em
  // Tasks, com staging). Não aparece em modo histórico (canvas congelado).
  const isStaging = planState.pendingCount > 0;
  const canvasTitle =
    view === "stories"
      ? "User Stories"
      : isStaging
        ? "Propostas de tasks"
        : "Plano (board vivo)";
  const canvasCount =
    view === "stories"
      ? storyCount
      : isStaging
        ? planState.pendingCount
        : planState.planCount;

  const toolbar = (
    <div className="flex w-full items-center gap-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="size-4 text-muted-foreground" />
        {canvasTitle}
        <Badge variant="secondary">{canvasCount}</Badge>
      </div>

      <div className="ml-1 inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs">
        {(["tasks", "stories"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              "rounded-md px-2.5 py-1 transition-colors",
              view === v
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v === "tasks" ? "Tasks" : "User Stories"}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <Button
        variant="outline"
        size="icon-sm"
        onClick={handleRefreshCanvas}
        title={hasNewContent ? "Novo conteúdo — recarregar" : "Recarregar canvas"}
        className={cn(
          "transition-colors",
          hasNewContent
            ? "border-primary/60 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
            : "text-muted-foreground",
        )}
      >
        <RotateCcw className="size-4" />
      </Button>

      {view === "tasks" && !isApproved && isStaging && (
        <Button
          size="sm"
          onClick={handleApplyBoard}
          disabled={applyBusy || busy}
          title={busy ? "Aguarde a Vitoria terminar de montar o plano" : undefined}
        >
          {applyBusy || busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          {busy ? "Vitoria montando…" : `Aplicar ${planState.pendingCount}`}
        </Button>
      )}
    </div>
  );

  // Canvas: board de tasks OU vista de user stories OU canvas histórico read-only.
  // PRD↔sprint board saiu (2026-06-19) — a planning lê fontes e produz tasks.
  // Conteúdo "board/lista" ocupa a folha de borda a borda → bleed; empty-state
  // (mensagem centrada) usa folha com padding de leitura.
  const showEmptyPlan = view === "tasks" && !hasPlan;
  const canvas = (
    <CanvasStage
      header={historyMode ? undefined : toolbar}
      bleed={!historyMode && !showEmptyPlan}
    >
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
      ) : view === "stories" ? (
        <ReleasePlanningStories
          projectId={projectId}
          refreshKey={actionsRefresh}
          onCountChange={setStoryCount}
          onOpenStory={setOpenStoryRef}
        />
      ) : (
        <>
          <ReleasePlanningProposals
            planningCeremonyId={session.planningCeremonyId}
            projectId={projectId}
            refreshKey={actionsRefresh}
            readOnly={isApproved}
            onStateChange={setPlanState}
          />
          {!hasPlan && (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              <p className="mb-4">
                Plano vazio. Peça pra Vitoria montar a partir das fontes (insumos +
                PRDs) — ela propõe as tasks por sprint, você revisa e aplica.
              </p>
              <Button
                variant="magic"
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
    </CanvasStage>
  );

  return (
    <>
      <PageTitle
        title={session.projectName ?? session.title}
        subtitle={
          sprints.length > 0
            ? `${session.title} · ${sprints.length} sprint${sprints.length === 1 ? "" : "s"} no contrato`
            : session.title
        }
      />

      <AgentSplit
        className="-mx-3 -my-4 h-[calc(100svh-3rem)] sm:-mx-4 md:h-[calc(100svh-3.5rem)] lg:-m-6"
        ribbon={
          <>
            <ReleasePlanningRibbon
              title={session.title}
              phaseLabel={phase.label}
              phaseTone={phase.tone}
              scheduledFor={session.scheduledFor}
              sprintCount={sprints.length}
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
              onOpenVersions={() => setHistorySheetOpen(true)}
            />
            {/* Mini-régua sempre visível no ribbon — glance + entrada. Click num
                bloco abre o side-sheet e entra no modo histórico. */}
            <CronogramaRail
              label="Histórico"
              blocks={blocks}
              selectedKey={historyBlockKey}
              onSelect={handleSelectBlock}
            />
          </>
        }
        canvas={canvas}
        chat={chatPanel}
        chatAsDrawer={chatAsDrawer}
        drawer={
          <>
            <ConversationFab
              agent="vitoria"
              isOpen={mobileOpen}
              onClick={() => setMobileOpen(!mobileOpen)}
            />
            {chatPanel}
          </>
        }
      />

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
          status: session.status,
        }}
        onUpdated={loadSession}
        onDeleted={loadSession}
        onSprintsGenerated={loadSprints}
      />

      <StoryDetailSheet
        storyRef={openStoryRef}
        onClose={() => setOpenStoryRef(null)}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </>
  );
}
