"use client";

import { useMemo } from "react";
import {
  CalendarClock,
  Check,
  CircleAlert,
  CircleDot,
  FileText,
  Info,
  Mic,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  StickyNote,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { fmtDate as fmtShortDate } from "@/lib/date-utils";

type PMReviewNoteKind =
  | "summary"
  | "project_direction"
  | "next_step"
  | "risk"
  | "need"
  | "team_signal"
  | "open_decision";

const KIND_LABEL: Record<PMReviewNoteKind, string> = {
  summary: "Panorama",
  project_direction: "Rumo",
  next_step: "Próximo passo",
  risk: "Risco",
  need: "Necessidade",
  team_signal: "Indicador",
  open_decision: "Decisão em aberto",
};

const KIND_TONE: Record<
  PMReviewNoteKind,
  { bg: string; text: string; border: string }
> = {
  summary: {
    bg: "bg-slate-100 dark:bg-slate-800/40",
    text: "text-slate-700 dark:text-slate-300",
    border: "border-slate-300 dark:border-slate-700",
  },
  project_direction: {
    bg: "bg-violet-100 dark:bg-violet-950/40",
    text: "text-violet-700 dark:text-violet-300",
    border: "border-violet-300 dark:border-violet-800",
  },
  next_step: {
    bg: "bg-sky-100 dark:bg-sky-950/40",
    text: "text-sky-700 dark:text-sky-300",
    border: "border-sky-300 dark:border-sky-800",
  },
  risk: {
    bg: "bg-amber-100 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-300 dark:border-amber-800",
  },
  need: {
    bg: "bg-rose-100 dark:bg-rose-950/40",
    text: "text-rose-700 dark:text-rose-300",
    border: "border-rose-300 dark:border-rose-800",
  },
  team_signal: {
    bg: "bg-emerald-100 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-300 dark:border-emerald-800",
  },
  open_decision: {
    bg: "bg-orange-100 dark:bg-orange-950/40",
    text: "text-orange-700 dark:text-orange-300",
    border: "border-orange-300 dark:border-orange-800",
  },
};

type Note = {
  id: string;
  kind: string;
  content: string;
  priority: number;
  dismissedAt: string | null;
  generatedByAgent: string | null;
};

type LinkedTranscript = {
  transcriptRefId: string;
  transcript: {
    id: string;
    title: string | null;
    source: string;
    capturedAt: string | null;
  } | null;
};

type LinkedMeeting = {
  meetingId: string;
  meeting: {
    id: string;
    title: string | null;
    date: string;
  } | null;
};

type Props = {
  pmReviewId: string;
  linkedTranscripts: LinkedTranscript[];
  linkedMeetings: LinkedMeeting[];
  notes: Note[];
  hasReport: boolean;
  refreshing?: boolean;
  /** Abre o sheet de contexto. */
  onOpenInsumos: () => void;
  /** Envia mensagem direto pra Vitoria via chat. */
  onSendToVitoria: (text: string) => void;
  /** Pede sintese (clica botão final). */
  onSynthesize: () => void;
  /** Refetch do PMReview detail (após mutação de nota). */
  onChanged: () => void;
};

const NOTE_REQUEST_PROMPT =
  "Vitoria, com base no contexto linkado + contexto do projeto (DS, sprint, código), liste agora as notas tipadas: panorama (summary), rumo do projeto, próximos passos, riscos, necessidades, indicadores do time e decisões em aberto. Crie via add_pm_review_note. Se ainda não leu os transcripts, leia primeiro.";

/**
 * Critério mínimo pra habilitar Step 3.
 * ≥1 transcript linkado OU ≥3 notas ativas (matéria-prima alternativa).
 */
function canSynthesize(
  linkedCount: number,
  activeNotesCount: number,
): boolean {
  return linkedCount >= 1 || activeNotesCount >= 3;
}

export function PMReviewWizard({
  pmReviewId,
  linkedTranscripts,
  linkedMeetings,
  notes,
  hasReport,
  refreshing = false,
  onOpenInsumos,
  onSendToVitoria,
  onSynthesize,
  onChanged,
}: Props) {
  const activeNotes = useMemo(
    () => notes.filter((n) => !n.dismissedAt),
    [notes],
  );
  const dismissedNotes = useMemo(
    () => notes.filter((n) => n.dismissedAt),
    [notes],
  );

  const linkedCount = linkedTranscripts.length + linkedMeetings.length;
  const step1Done = linkedCount > 0;
  const step2Done = activeNotes.length >= 3;
  const step3Available = canSynthesize(linkedCount, activeNotes.length);

  const sortedActive = useMemo(
    () =>
      [...activeNotes].sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.kind.localeCompare(b.kind);
      }),
    [activeNotes],
  );

  async function toggleDismiss(note: Note) {
    try {
      await fetchOrThrow(
        `/api/pm-review/${pmReviewId}/notes/${note.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            note.dismissedAt ? { undismiss: true } : { dismiss: true },
          ),
        },
      );
      onChanged();
    } catch (err) {
      showErrorToast(err, { label: "Falha ao atualizar nota" });
    }
  }

  return (
    <div className="space-y-4">
      {/* ─── STEP 1 — CONTEXTO ────────────────────────────────────────────── */}
      <StepCard
        index={1}
        title="Contexto"
        subtitle="Material que a Vitoria vai ler pra sintetizar"
        done={step1Done}
      >
        {linkedCount === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhum contexto linkado ainda. Adicione transcripts ou reuniões do{" "}
            <strong>pool do projeto</strong> ou importe novos do Roam/Granola.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {linkedTranscripts.map((l) => (
              <li
                key={l.transcriptRefId}
                className="flex items-center gap-2 text-xs"
              >
                {l.transcript?.source === "granola" ||
                l.transcript?.source === "roam" ? (
                  <Mic className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {l.transcript?.title ?? "Transcript sem título"}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {l.transcript?.source}
                  {l.transcript?.capturedAt &&
                    ` · ${fmtShortDate(l.transcript.capturedAt)}`}
                </span>
              </li>
            ))}
            {linkedMeetings.map((l) => (
              <li
                key={l.meetingId}
                className="flex items-center gap-2 text-xs"
              >
                <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {l.meeting?.title ?? "Reunião sem título"}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  reunião
                  {l.meeting && ` · ${fmtShortDate(l.meeting.date)}`}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3">
          <Button size="sm" variant="outline" onClick={onOpenInsumos}>
            <Plus className="size-3.5" /> Curar contexto
          </Button>
        </div>
      </StepCard>

      {/* ─── STEP 2 — NOTAS ──────────────────────────────────────────────── */}
      <StepCard
        index={2}
        title="Notas"
        subtitle="Observações tipadas que vão pro report"
        done={step2Done}
        warn={!step2Done && activeNotes.length > 0}
      >
        <div className="mb-3 flex items-start gap-2 rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 size-3 shrink-0" />
          <span>
            Vitoria cria notas tipadas (rumo / próximo passo / risco /
            necessidade / sinal / decisão em aberto) lendo o contexto linkado e o
            contexto do projeto. Cada nota vai como item da seção
            correspondente no report final. <strong>Dispensar</strong> tira
            uma nota da síntese sem apagar o histórico.
          </span>
        </div>

        {sortedActive.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma nota ainda. Peça pra Vitoria coletar — ela lê o contexto
            linkado e cria as notas baseadas nele.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {sortedActive.map((n) => {
              const k = n.kind as PMReviewNoteKind;
              const tone = KIND_TONE[k] ?? KIND_TONE.summary;
              return (
                <li
                  key={n.id}
                  className="group flex items-start gap-2 rounded-md border bg-card p-2 text-xs"
                >
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
                      tone.bg,
                      tone.text,
                      tone.border,
                    )}
                  >
                    {KIND_LABEL[k] ?? n.kind}
                  </span>
                  <span className="min-w-0 flex-1 leading-relaxed">
                    {n.content}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1 opacity-60 group-hover:opacity-100"
                    title="Dispensar (tira do report)"
                    onClick={() => toggleDismiss(n)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        {dismissedNotes.length > 0 && (
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-[11px] text-muted-foreground">
              Dispensadas ({dismissedNotes.length})
            </summary>
            <ul className="mt-2 space-y-1">
              {dismissedNotes.map((n) => (
                <li
                  key={n.id}
                  className="flex items-start gap-2 text-[11px] text-muted-foreground line-through"
                >
                  <span className="flex-1">
                    [{KIND_LABEL[n.kind as PMReviewNoteKind] ?? n.kind}]{" "}
                    {n.content}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1 no-underline"
                    title="Restaurar"
                    onClick={() => toggleDismiss(n)}
                  >
                    <Undo2 className="size-3" />
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => onSendToVitoria(NOTE_REQUEST_PROMPT)}
            disabled={linkedCount === 0 && activeNotes.length === 0}
            title={
              linkedCount === 0
                ? "Adicione ≥1 contexto no Passo 1 antes de pedir notas"
                : undefined
            }
          >
            <MessageSquare className="size-3.5" /> Pedir notas pra Vitoria
          </Button>
          <span className="self-center text-[10px] text-muted-foreground">
            {activeNotes.length}/3 mínimas pra sintetizar sem transcript
          </span>
        </div>
      </StepCard>

      {/* ─── STEP 3 — SÍNTESE ────────────────────────────────────────────── */}
      <StepCard
        index={3}
        title="Sintetizar report"
        subtitle="Vitoria escreve o markdown final nas 6 seções fixas"
        done={hasReport}
      >
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            Pronto quando: <strong>≥1 transcript linkado</strong>{" "}
            <em>OU</em> <strong>≥3 notas ativas</strong>.
          </p>
          <p className="text-[11px]">
            DS, business context e indicadores do time (velocity, FP) são
            carregados automaticamente pra Vitoria — você não precisa fazer
            nada além dos passos 1 e 2.
          </p>
        </div>

        <div className="mt-3">
          <Button
            size="sm"
            variant={hasReport ? "outline" : "default"}
            onClick={onSynthesize}
            disabled={refreshing || !step3Available}
            title={
              !step3Available
                ? "Complete o Passo 1 ou 2 antes de sintetizar"
                : undefined
            }
          >
            {refreshing ? (
              <>
                <RefreshCw className="size-3.5 animate-spin" /> Sintetizando…
              </>
            ) : hasReport ? (
              <>
                <RefreshCw className="size-3.5" /> Atualizar report
              </>
            ) : (
              <>
                <Sparkles className="size-3.5" /> Sintetizar report
              </>
            )}
          </Button>
        </div>
      </StepCard>
    </div>
  );
}

// ─── Subcomponentes ────────────────────────────────────────────────────────

function StepCard({
  index,
  title,
  subtitle,
  done,
  warn,
  children,
}: {
  index: number;
  title: string;
  subtitle: string;
  done?: boolean;
  warn?: boolean;
  children: React.ReactNode;
}) {
  const StateIcon = done ? Check : warn ? CircleAlert : CircleDot;
  const stateClass = done
    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    : warn
      ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
      : "border-border bg-muted/40 text-muted-foreground";

  return (
    <section className="rounded-lg border bg-card">
      <header className="flex items-start gap-3 border-b p-3">
        <span
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
            stateClass,
          )}
        >
          {done || warn ? (
            <StateIcon className="size-3.5" />
          ) : (
            <span>{index}</span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">
            Passo {index} · {title}
          </h3>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

// Export do ícone aux pra ser usado externamente se quiser.
export const PMReviewNoteIcon = StickyNote;
