"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  Loader2,
  MessageSquare,
  RotateCcw,
  Sparkles,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageTitle } from "@/components/app-shell";
import { StatusChip } from "@/components/ui/status-chip";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { ConversationFab } from "@/components/ui/conversation/conversation-fab";
import { ConversationPanel } from "@/components/ui/conversation";
import { useIsMobile } from "@/hooks/use-mobile";
import { readPlanMode, useChatPlanMode } from "@/hooks/use-chat-plan-mode";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { fmtDate } from "@/lib/date-utils";
import type { PlanningDetail } from "@/lib/dal/planning";
import type { PlanningPhase } from "@/lib/planning/phase";
import type { ChipTone } from "@/lib/status-chips";

// ─── Types ────────────────────────────────────────────────────────────────

type PlanningAction = {
  id: string;
  type: "create" | "update" | "delete" | "move" | "review";
  payload: Record<string, unknown>;
  decision: "pending" | "approved" | "rejected";
  execution: "pending" | "applied" | "failed" | "skipped";
  source: "ai" | "manual";
  aiReasoning: string | null;
  aiConfidence: number | null;
  errorMessage: string | null;
  notes: string | null;
  reviewReasons: string[] | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
  meetingId: string | null;
  planningCeremonyId: string | null;
  projectId: string;
  taskId: string | null;
  targetSprintId: string | null;
  task: {
    id: string;
    reference: string | null;
    title: string;
    status: string;
    scope: string;
    type: string;
    priority: number;
    sprintId: string | null;
    projectId: string;
  } | null;
  targetSprint: { id: string; name: string } | null;
};

type MeetingOption = {
  id: string;
  title: string | null;
  date: string;
  kind: string;
};

type TranscriptOption = {
  id: string;
  title: string | null;
  source: string;
  capturedAt: string | null;
  byline: string | null;
};

// ─── Constants ───────────────────────────────────────────────────────────

const PHASE_META: Record<PlanningPhase, { label: string; tone: ChipTone }> = {
  idle: { label: "Aguardando", tone: "slate" },
  reading: { label: "Leitura", tone: "blue" },
  proposing: { label: "Propondo", tone: "amber" },
  approving: { label: "Revisão", tone: "cyan" },
  closed: { label: "Concluída", tone: "green" },
  archived: { label: "Arquivada", tone: "muted" },
};

const ACTION_TYPE_LABEL: Record<string, string> = {
  create: "Criar",
  update: "Atualizar",
  delete: "Excluir",
  move: "Mover",
  review: "Revisar",
};

const NOTE_KIND_LABEL: Record<string, string> = {
  summary: "Resumo",
  theme: "Tema",
  risk: "Risco",
  capacity_signal: "Capacidade",
  code_observation: "Código",
  open_question: "Questão",
};

const NOTE_KIND_TONE: Record<string, ChipTone> = {
  summary: "blue",
  theme: "purple",
  risk: "red",
  capacity_signal: "amber",
  code_observation: "muted",
  open_question: "cyan",
};

// ─── Phase controls ───────────────────────────────────────────────────────

function PhaseRibbon({
  planning,
  onTransition,
  transitioning,
}: {
  planning: PlanningDetail;
  onTransition: (to: PlanningPhase) => void;
  transitioning: boolean;
}) {
  const { phase } = planning;
  const meta = PHASE_META[phase];
  const hasContent =
    planning.linkedMeetingCount > 0 || planning.linkedTranscriptCount > 0;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <StatusChip tone={meta.tone} label={meta.label} dot />

      {phase === "idle" && (
        <Button
          size="sm"
          disabled={!hasContent || transitioning}
          title={!hasContent ? "Adicione ≥1 reunião ou transcript antes de iniciar" : undefined}
          onClick={() => onTransition("reading")}
        >
          {transitioning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BookOpen className="mr-1.5 h-3.5 w-3.5" />}
          Iniciar leitura
        </Button>
      )}

      {(phase === "reading" || phase === "proposing") && (
        <Button
          size="sm"
          variant="outline"
          disabled={transitioning}
          onClick={() => onTransition("idle")}
        >
          {transitioning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
          Resetar briefing
        </Button>
      )}

      {phase === "proposing" && (
        <Button
          size="sm"
          disabled={planning.pendingActionCount < 1 || transitioning}
          title={planning.pendingActionCount < 1 ? "Nenhuma proposta pendente pra revisar" : undefined}
          onClick={() => onTransition("approving")}
        >
          {transitioning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
          Revisar propostas ({planning.pendingActionCount})
        </Button>
      )}

      {phase === "approving" && (
        <Button
          size="sm"
          disabled={planning.pendingActionCount > 0 || transitioning}
          title={planning.pendingActionCount > 0 ? `Ainda há ${planning.pendingActionCount} proposta(s) pendente(s)` : undefined}
          onClick={() => onTransition("closed")}
        >
          {transitioning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
          Fechar planning
        </Button>
      )}

      {phase === "closed" && (
        <Button
          size="sm"
          variant="outline"
          disabled={transitioning}
          onClick={() => onTransition("archived")}
        >
          {transitioning && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Arquivar
        </Button>
      )}
    </div>
  );
}

// ─── Meeting picker ───────────────────────────────────────────────────────

function MeetingPickerDialog({
  open,
  onOpenChange,
  linkedIds,
  onLink,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  linkedIds: Set<string>;
  onLink: (meetingId: string) => Promise<void>;
}) {
  const [meetings, setMeetings] = useState<MeetingOption[]>([]);
  const [q, setQ] = useState("");
  const [linking, setLinking] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/meetings")
      .then((r) => r.json())
      .then((data: Array<{ id: string; title: string | null; date: string; kind?: string; type?: string }>) => {
        setMeetings(
          data.map((m) => ({
            id: m.id,
            title: m.title,
            date: m.date,
            kind: m.kind ?? m.type ?? "general",
          })),
        );
      })
      .catch(() => {});
  }, [open]);

  const filtered = meetings.filter((m) => {
    if (linkedIds.has(m.id)) return false;
    if (!q) return true;
    const search = q.toLowerCase();
    return (m.title ?? "").toLowerCase().includes(search) || fmtDate(m.date).includes(search);
  });

  const handleLink = async (id: string) => {
    setLinking(id);
    try {
      await onLink(id);
      onOpenChange(false);
    } finally {
      setLinking(null);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Adicionar reunião</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="px-4 py-2 space-y-3">
          <Input
            placeholder="Buscar..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="max-h-72 overflow-y-auto divide-y rounded-md border">
            {filtered.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground text-center">
                {meetings.length === 0 ? "Carregando…" : "Nenhuma reunião encontrada."}
              </div>
            )}
            {filtered.map((m) => (
              <button
                key={m.id}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
                onClick={() => handleLink(m.id)}
                disabled={linking === m.id}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{m.title ?? `Reunião ${fmtDate(m.date)}`}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(m.date)}</p>
                </div>
                {linking === m.id ? (
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveDialogFooter className="px-4 pb-4">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

// ─── Transcript picker ────────────────────────────────────────────────────

function TranscriptPickerDialog({
  open,
  onOpenChange,
  linkedIds,
  onLink,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  linkedIds: Set<string>;
  onLink: (transcriptRefId: string) => Promise<void>;
}) {
  const [transcripts, setTranscripts] = useState<TranscriptOption[]>([]);
  const [q, setQ] = useState("");
  const [linking, setLinking] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/transcripts")
      .then((r) => r.json())
      .then((data: TranscriptOption[]) => setTranscripts(data))
      .catch(() => {});
  }, [open]);

  const filtered = transcripts.filter((t) => {
    if (linkedIds.has(t.id)) return false;
    if (!q) return true;
    const search = q.toLowerCase();
    return (t.title ?? "").toLowerCase().includes(search) ||
      (t.byline ?? "").toLowerCase().includes(search);
  });

  const handleLink = async (id: string) => {
    setLinking(id);
    try {
      await onLink(id);
      onOpenChange(false);
    } finally {
      setLinking(null);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Adicionar transcript</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <div className="px-4 py-2 space-y-3">
          <Input
            placeholder="Buscar..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="max-h-72 overflow-y-auto divide-y rounded-md border">
            {filtered.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground text-center">
                {transcripts.length === 0 ? "Carregando…" : "Nenhum transcript encontrado."}
              </div>
            )}
            {filtered.map((t) => (
              <button
                key={t.id}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
                onClick={() => handleLink(t.id)}
                disabled={linking === t.id}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{t.title ?? "Transcript sem título"}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.source}
                    {t.capturedAt ? ` · ${fmtDate(t.capturedAt)}` : ""}
                    {t.byline ? ` · ${t.byline}` : ""}
                  </p>
                </div>
                {linking === t.id ? (
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveDialogFooter className="px-4 pb-4">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────

export default function RitualDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [planning, setPlanning] = useState<PlanningDetail | null>(null);
  const [actions, setActions] = useState<PlanningAction[]>([]);
  const [loadError, setLoadError] = useState<"notfound" | "forbidden" | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [meetingPickerOpen, setMeetingPickerOpen] = useState(false);
  const [transcriptPickerOpen, setTranscriptPickerOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);

  const threadIdRef = useRef<string | null>(null);
  threadIdRef.current = threadId;

  const isMobile = useIsMobile();
  const { planMode, setPlanMode } = useChatPlanMode("vitoria");
  const [input, setInput] = useState("");

  // ─── Data loading ────────────────────────────────────────────────────

  const loadPlanning = useCallback(async () => {
    const r = await fetch(`/api/planning/${id}`);
    if (r.status === 404) { setLoadError("notfound"); return; }
    if (r.status === 403) { setLoadError("forbidden"); return; }
    if (!r.ok) { setLoadError("forbidden"); return; }
    const data = await r.json();
    setLoadError(null);
    setPlanning(data);
  }, [id]);

  const loadActions = useCallback(async () => {
    const r = await fetch(`/api/planning/${id}/actions`);
    if (r.ok) setActions(await r.json());
  }, [id]);

  useEffect(() => {
    loadPlanning();
    loadActions();
  }, [loadPlanning, loadActions]);

  // ─── Chat ─────────────────────────────────────────────────────────────

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/planning/${id}/chat`,
        body: {
          planningId: id,
          get threadId() {
            return threadIdRef.current;
          },
          get planMode() {
            return readPlanMode("vitoria");
          },
        },
        fetch: async (input, init) => {
          const res = await fetch(input as RequestInfo, init);
          const tid = res.headers.get("X-Thread-Id");
          if (tid) setThreadId(tid);
          return res;
        },
      }),
    [id],
  );

  const { messages, status, sendMessage, stop, setMessages } = useChat({ transport });

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || status === "streaming" || status === "submitted") return;
    sendMessage({ text }, { body: { threadId, planningId: id } });
    setInput("");
  }, [input, status, sendMessage, threadId, id]);

  // ─── Phase transition ──────────────────────────────────────────────────

  const handleTransition = async (to: PlanningPhase) => {
    if (!planning) return;
    const needsConfirm = to === "idle" && (planning.phase === "reading" || planning.phase === "proposing");
    if (needsConfirm) {
      setConfirmState({
        title: "Resetar briefing?",
        description: "Todas as notas de contexto geradas serão excluídas. Essa ação não pode ser desfeita.",
        confirmLabel: "Resetar",
        destructive: true,
        onConfirm: () => doTransition(to),
      });
      return;
    }
    await doTransition(to);
  };

  const doTransition = async (to: PlanningPhase) => {
    setTransitioning(true);
    try {
      await fetchOrThrow(`/api/planning/${id}/phase`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });
      await loadPlanning();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao mudar fase" });
    } finally {
      setTransitioning(false);
    }
  };

  // ─── Meeting curadoria ─────────────────────────────────────────────────

  const linkedMeetingIds = useMemo(
    () => new Set((planning?.linkedMeetings ?? []).map((l) => l.meetingId)),
    [planning],
  );

  const handleLinkMeeting = async (meetingId: string) => {
    try {
      await fetchOrThrow(`/api/planning/${id}/meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId }),
      });
      await loadPlanning();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao linkar reunião" });
    }
  };

  const handleUnlinkMeeting = (meetingId: string, title: string) => {
    setConfirmState({
      title: "Remover reunião?",
      description: `"${title}" será desvinculada desta planning.`,
      confirmLabel: "Remover",
      destructive: true,
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/planning/${id}/meetings?meetingId=${meetingId}`, {
            method: "DELETE",
          });
          await loadPlanning();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao remover reunião" });
        }
      },
    });
  };

  // ─── Transcript curadoria ──────────────────────────────────────────────

  const linkedTranscriptIds = useMemo(
    () => new Set((planning?.linkedTranscripts ?? []).map((l) => l.transcriptRefId)),
    [planning],
  );

  const handleLinkTranscript = async (transcriptRefId: string) => {
    try {
      await fetchOrThrow(`/api/planning/${id}/transcripts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcriptRefId }),
      });
      await loadPlanning();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao linkar transcript" });
    }
  };

  const handleUnlinkTranscript = (transcriptRefId: string, title: string) => {
    setConfirmState({
      title: "Remover transcript?",
      description: `"${title}" será desvinculado desta planning.`,
      confirmLabel: "Remover",
      destructive: true,
      onConfirm: async () => {
        try {
          await fetchOrThrow(
            `/api/planning/${id}/transcripts?transcriptRefId=${transcriptRefId}`,
            { method: "DELETE" },
          );
          await loadPlanning();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao remover transcript" });
        }
      },
    });
  };

  // ─── Note dismiss ──────────────────────────────────────────────────────

  const handleDismissNote = (noteId: string) => {
    setConfirmState({
      title: "Dispensar nota?",
      description: "A nota será ocultada do contexto ativo.",
      confirmLabel: "Dispensar",
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/planning/${id}/notes/${noteId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dismissed: true }),
          });
          await loadPlanning();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao dispensar nota" });
        }
      },
    });
  };

  // ─── Action decision ───────────────────────────────────────────────────

  const handleDecideAction = async (actionId: string, decision: "approved" | "rejected") => {
    setActions((prev) =>
      prev.map((a) => (a.id === actionId ? { ...a, decision } : a)),
    );
    try {
      await fetchOrThrow(`/api/planning/${id}/actions/${actionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      // approved/rejected sempre decrementa pendingCount (veio de pending)
      setPlanning((prev) =>
        prev
          ? { ...prev, pendingActionCount: Math.max(0, prev.pendingActionCount - 1) }
          : prev,
      );
    } catch (e) {
      setActions((prev) =>
        prev.map((a) => (a.id === actionId ? { ...a, decision: "pending" } : a)),
      );
      showErrorToast(e, { label: "Falha ao salvar decisão" });
    }
  };

  // ─── Render guards ────────────────────────────────────────────────────

  if (loadError === "notfound") {
    return (
      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">Ritual não encontrado.</p>
        <Link href="/rituals">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Voltar
          </Button>
        </Link>
      </div>
    );
  }

  if (loadError === "forbidden") {
    return (
      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">Você não tem acesso a este ritual.</p>
        <Link href="/rituals">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Voltar
          </Button>
        </Link>
      </div>
    );
  }

  if (!planning) {
    return <div className="p-6 text-muted-foreground text-sm">Carregando…</div>;
  }

  const activeNotes = planning.notes.filter((n) => !n.dismissedAt);
  const pendingActions = actions.filter((a) => a.decision === "pending");
  const decidedActions = actions.filter((a) => a.decision !== "pending");

  // ─── Render ───────────────────────────────────────────────────────────

  const title = planning.sprintName
    ? `Planning · ${planning.sprintName}`
    : "Planning";

  const leftPane = (
    <div className="space-y-4 min-w-0">
      {/* ── Header ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Link href="/rituals">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold truncate">{title}</h1>
            {planning.scheduledFor && (
              <p className="text-xs text-muted-foreground">{fmtDate(planning.scheduledFor)}</p>
            )}
          </div>
        </div>

        <PhaseRibbon
          planning={planning}
          onTransition={handleTransition}
          transitioning={transitioning}
        />

        {planning.facilitatorName && (
          <p className="text-xs text-muted-foreground">
            Facilitador: {planning.facilitatorName}
          </p>
        )}
      </div>

      {/* ── Curadoria — Reuniões ── */}
      <section className="surface p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Reuniões{" "}
            <span className="font-normal normal-case">
              ({planning.linkedMeetingCount})
            </span>
          </h2>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setMeetingPickerOpen(true)}
          >
            Adicionar
          </Button>
        </div>

        {planning.linkedMeetings.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhuma reunião vinculada.</p>
        ) : (
          <ul className="divide-y">
            {planning.linkedMeetings.map((l) => (
              <li key={l.meetingId} className="flex items-center gap-2 py-2">
                <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">
                    {l.meeting?.title ?? `Reunião ${l.meeting?.date ? fmtDate(l.meeting.date) : l.meetingId}`}
                  </p>
                  {l.meeting?.date && (
                    <p className="text-xs text-muted-foreground">{fmtDate(l.meeting.date)}</p>
                  )}
                </div>
                {l.meeting && (
                  <Link
                    href={`/meetings/${l.meetingId}`}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  >
                    ver
                  </Link>
                )}
                <button
                  className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  title="Desvincular"
                  onClick={() =>
                    handleUnlinkMeeting(
                      l.meetingId,
                      l.meeting?.title ?? "esta reunião",
                    )
                  }
                >
                  <Unlink className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Curadoria — Transcripts ── */}
      <section className="surface p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Transcripts{" "}
            <span className="font-normal normal-case">
              ({planning.linkedTranscriptCount})
            </span>
          </h2>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setTranscriptPickerOpen(true)}
          >
            Adicionar
          </Button>
        </div>

        {planning.linkedTranscripts.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum transcript vinculado.</p>
        ) : (
          <ul className="divide-y">
            {planning.linkedTranscripts.map((l) => (
              <li key={l.transcriptRefId} className="flex items-center gap-2 py-2">
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
                  className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  title="Desvincular"
                  onClick={() =>
                    handleUnlinkTranscript(
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
      </section>

      {/* ── Context Notes ── */}
      {(activeNotes.length > 0 || planning.phase === "reading" || planning.phase === "proposing") && (
        <section className="surface p-4 space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Notas do briefing{" "}
            <span className="font-normal normal-case">({activeNotes.length})</span>
          </h2>

          {activeNotes.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {planning.phase === "reading"
                ? "Vitoria está lendo os insumos…"
                : "Nenhuma nota ativa."}
            </p>
          ) : (
            <ul className="space-y-2">
              {activeNotes.map((note) => (
                <li
                  key={note.id}
                  className="rounded-lg border p-3 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <StatusChip
                      tone={NOTE_KIND_TONE[note.kind] ?? "neutral"}
                      label={NOTE_KIND_LABEL[note.kind] ?? note.kind}
                    />
                    <button
                      className="text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                      title="Dispensar"
                      onClick={() => handleDismissNote(note.id)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="text-sm leading-relaxed">{note.content}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── Actions — Propostas pendentes ── */}
      {(planning.phase === "proposing" || planning.phase === "approving" || pendingActions.length > 0) && (
        <section className="surface p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-500" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Propostas{" "}
              <span className="font-normal normal-case">
                ({pendingActions.length} pendente{pendingActions.length !== 1 ? "s" : ""})
              </span>
            </h2>
          </div>

          {pendingActions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {planning.phase === "proposing"
                ? "Vitoria está gerando propostas…"
                : "Nenhuma proposta pendente."}
            </p>
          ) : (
            <ul className="divide-y">
              {pendingActions.map((action) => (
                <ActionRow
                  key={action.id}
                  action={action}
                  onApprove={() => handleDecideAction(action.id, "approved")}
                  onReject={() => handleDecideAction(action.id, "rejected")}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── Actions — Decididas ── */}
      {decidedActions.length > 0 && (
        <section className="surface p-4 space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Revisadas{" "}
            <span className="font-normal normal-case">({decidedActions.length})</span>
          </h2>
          <ul className="divide-y">
            {decidedActions.map((action) => (
              <ActionRow key={action.id} action={action} decided />
            ))}
          </ul>
        </section>
      )}
    </div>
  );

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
      planMode={planMode}
      onPlanModeChange={setPlanMode}
      className="h-full"
    />
  );

  return (
    <div className="min-h-0 h-full flex flex-col">
      <PageTitle title={title} />

      <div className="flex-1 min-h-0 lg:grid lg:grid-cols-[1fr_380px] lg:gap-4 lg:overflow-hidden">
        {/* Left — scrollable */}
        <div className="overflow-y-auto p-4 lg:p-6 space-y-0">
          {leftPane}
        </div>

        {/* Right — chat, sticky desktop */}
        {!isMobile && (
          <div className="hidden lg:flex lg:flex-col lg:overflow-hidden lg:py-4 lg:pr-4">
            {chatPanel}
          </div>
        )}
      </div>

      {/* Mobile — chat FAB */}
      {isMobile && (
        <>
          <ConversationFab agent="vitoria" isOpen={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)} />
          {chatPanel}
        </>
      )}

      {/* Dialogs */}
      <MeetingPickerDialog
        open={meetingPickerOpen}
        onOpenChange={setMeetingPickerOpen}
        linkedIds={linkedMeetingIds}
        onLink={handleLinkMeeting}
      />

      <TranscriptPickerDialog
        open={transcriptPickerOpen}
        onOpenChange={setTranscriptPickerOpen}
        linkedIds={linkedTranscriptIds}
        onLink={handleLinkTranscript}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}

// ─── ActionRow ─────────────────────────────────────────────────────────────

function ActionRow({
  action,
  onApprove,
  onReject,
  decided = false,
}: {
  action: PlanningAction;
  onApprove?: () => void;
  onReject?: () => void;
  decided?: boolean;
}) {
  const taskTitle =
    action.task?.title ??
    (action.payload?.title as string | undefined) ??
    (action.payload?.description as string | undefined) ??
    "—";

  const typeTone: ChipTone =
    action.type === "delete" ? "red" : action.type === "create" ? "green" : "slate";

  return (
    <li className="py-3 space-y-1.5">
      <div className="flex items-start gap-2">
        <StatusChip tone={typeTone} label={ACTION_TYPE_LABEL[action.type] ?? action.type} />
        <p className="flex-1 text-sm font-medium leading-snug min-w-0 truncate">
          {taskTitle}
        </p>
        {decided && (
          <StatusChip
            tone={action.decision === "approved" ? "green" : "red"}
            label={action.decision === "approved" ? "Aprovado" : "Rejeitado"}
          />
        )}
      </div>

      {action.aiReasoning && (
        <p className="text-xs text-muted-foreground line-clamp-2 pl-0.5">
          {action.aiReasoning}
        </p>
      )}

      {action.task && (
        <div className="flex items-center gap-3 pl-0.5">
          <Link
            href={`/projects/${action.task.projectId}`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {action.task.reference && `#${action.task.reference} · `}ver projeto
          </Link>
        </div>
      )}

      {!decided && onApprove && onReject && (
        <div className="flex items-center gap-2 pt-0.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-green-700 border-green-200 hover:bg-green-50"
            onClick={onApprove}
          >
            <Check className="mr-1 h-3 w-3" />
            Aprovar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-red-700 border-red-200 hover:bg-red-50"
            onClick={onReject}
          >
            <X className="mr-1 h-3 w-3" />
            Rejeitar
          </Button>
        </div>
      )}
    </li>
  );
}
