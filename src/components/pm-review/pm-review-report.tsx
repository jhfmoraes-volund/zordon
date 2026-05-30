"use client";

import { useMemo } from "react";
import {
  Check,
  ChartLine,
  Circle,
  RefreshCw,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";

type PMReviewNoteKind =
  | "summary"
  | "project_direction"
  | "next_step"
  | "risk"
  | "need"
  | "team_signal"
  | "open_decision";

type Note = {
  id: string;
  kind: PMReviewNoteKind | string;
  content: string;
  priority: number;
  dismissedAt: string | null;
};

const KIND_TITLE: Record<PMReviewNoteKind, string> = {
  summary: "Panorama",
  project_direction: "Rumo do projeto",
  next_step: "Próximos passos",
  risk: "Riscos",
  need: "Necessidades",
  team_signal: "Indicadores do time",
  open_decision: "Decisões em aberto",
};

const SECTION_ORDER: PMReviewNoteKind[] = [
  "summary",
  "project_direction",
  "next_step",
  "risk",
  "need",
  "team_signal",
  "open_decision",
];

type ProjectContext = {
  hasTranscripts: boolean;
  hasActiveDS: boolean;
  hasSprint: boolean;
  hasNotesEnough: boolean;
};

type Props = {
  reportMarkdown: string | null;
  reportGeneratedAt: string | null;
  notes: Note[];
  projectContext: ProjectContext;
  /** Pede pra Vitoria sintetizar — dispara mensagem no chat. */
  onRequestSync?: () => void;
  refreshing?: boolean;
};

/**
 * Vitoria precisa de matéria-prima pra sintetizar.
 * Critério mínimo: ao menos 1 transcript linkado OU ≥3 notes já criadas.
 * DS + Sprint contam como bônus de contexto mas não bloqueiam — projeto pode
 * ser greenfield e ainda assim ter um PM Review baseado só em transcripts.
 */
function hasMinimumContext(ctx: ProjectContext): boolean {
  return ctx.hasTranscripts || ctx.hasNotesEnough;
}

export function PMReviewReport({
  reportMarkdown,
  reportGeneratedAt,
  notes,
  projectContext,
  onRequestSync,
  refreshing = false,
}: Props) {
  const activeNotes = useMemo(
    () => notes.filter((n) => !n.dismissedAt),
    [notes],
  );

  const notesByKind = useMemo(() => {
    const map: Partial<Record<PMReviewNoteKind, Note[]>> = {};
    for (const n of activeNotes) {
      const k = n.kind as PMReviewNoteKind;
      if (!SECTION_ORDER.includes(k)) continue;
      (map[k] ?? (map[k] = [])).push(n);
    }
    return map;
  }, [activeNotes]);

  const canSync = hasMinimumContext(projectContext);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3 border-b pb-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ChartLine className="size-4" />
          <span>
            {reportGeneratedAt
              ? `Última síntese ${new Date(reportGeneratedAt).toLocaleString("pt-BR")}`
              : "Report ainda não foi sintetizado"}
          </span>
        </div>
        {onRequestSync && (
          <Button
            size="sm"
            variant={reportMarkdown ? "outline" : "default"}
            onClick={onRequestSync}
            disabled={refreshing || !canSync}
            title={
              !canSync
                ? "Linke ≥1 transcript ou crie ≥3 notas antes de sintetizar."
                : undefined
            }
          >
            <RefreshCw
              className={cn("size-3.5", refreshing && "animate-spin")}
            />
            {refreshing
              ? "Sintetizando…"
              : reportMarkdown
                ? "Atualizar report"
                : "Sintetizar report"}
          </Button>
        )}
      </header>

      {reportMarkdown ? (
        <article className="prose prose-sm max-w-none dark:prose-invert">
          <Markdown>{reportMarkdown}</Markdown>
        </article>
      ) : (
        <EmptyReport
          projectContext={projectContext}
          notesCount={activeNotes.length}
        />
      )}

      {/* Fontes — collapsible com as notas tipadas */}
      {activeNotes.length > 0 && (
        <details className="mt-6 rounded-md border bg-muted/20 p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Fontes ({activeNotes.length} nota{activeNotes.length > 1 ? "s" : ""})
          </summary>
          <div className="mt-3 space-y-4">
            {SECTION_ORDER.map((kind) => {
              const list = notesByKind[kind] ?? [];
              if (list.length === 0) return null;
              return (
                <section key={kind}>
                  <h4 className="text-xs font-semibold text-foreground">
                    {KIND_TITLE[kind]}{" "}
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {list.length}
                    </span>
                  </h4>
                  <ul className="mt-1.5 space-y-1">
                    {list
                      .sort((a, b) => b.priority - a.priority)
                      .map((n) => (
                        <li
                          key={n.id}
                          className="flex items-start gap-2 text-xs text-muted-foreground"
                        >
                          <StickyNote className="mt-0.5 size-3 shrink-0 opacity-50" />
                          <span className="leading-relaxed">{n.content}</span>
                        </li>
                      ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

function EmptyReport({
  projectContext,
  notesCount,
}: {
  projectContext: ProjectContext;
  notesCount: number;
}) {
  const items: Array<{
    ok: boolean;
    label: string;
    detail: string;
    required: boolean;
  }> = [
    {
      ok: projectContext.hasTranscripts,
      label: "Transcripts linkados",
      detail: projectContext.hasTranscripts
        ? "ok"
        : "linke pelo menos 1 via 'Contexto' no ribbon",
      required: !projectContext.hasNotesEnough,
    },
    {
      ok: projectContext.hasActiveDS,
      label: "Design Session ativa",
      detail: projectContext.hasActiveDS
        ? "Vitor já tem decisões e questões abertas pra Vitoria ler"
        : "opcional — síntese ainda funciona sem DS",
      required: false,
    },
    {
      ok: projectContext.hasSprint,
      label: "Ops Info (capacity / FP / velocity)",
      detail: projectContext.hasSprint
        ? "projeto tem sprint — Vitoria consulta via get_project_indicators"
        : "opcional — sem sprint, indicadores ficam vazios no report",
      required: false,
    },
    {
      ok: projectContext.hasNotesEnough,
      label: `Notas ativas (${notesCount}/3 mínimas)`,
      detail: projectContext.hasNotesEnough
        ? "matéria-prima suficiente pra sintetizar mesmo sem transcripts"
        : "converse com a Vitoria pra ela coletar notas (ex: 'lista os riscos do projeto')",
      required: !projectContext.hasTranscripts,
    },
  ];

  const blocking = !hasMinimumContext(projectContext);

  return (
    <div className="rounded-lg border border-dashed bg-muted/20 p-6">
      <div className="flex items-start gap-3">
        <ChartLine className="mt-0.5 size-8 shrink-0 opacity-30" />
        <div className="flex-1">
          <p className="text-sm font-medium">Report ainda não foi sintetizado</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {blocking
              ? "Vitoria precisa de matéria-prima pra sintetizar com qualidade. Marque ao menos um dos requisitos abaixo:"
              : "Tudo pronto. Clique em 'Sintetizar report' acima quando quiser que a Vitoria gere a síntese."}
          </p>

          <ul className="mt-4 space-y-2">
            {items.map((item) => (
              <li key={item.label} className="flex items-start gap-2 text-xs">
                {item.ok ? (
                  <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                ) : (
                  <Circle
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      item.required
                        ? "text-amber-500"
                        : "text-muted-foreground opacity-60",
                    )}
                  />
                )}
                <div className="min-w-0">
                  <span
                    className={cn(
                      "font-medium",
                      item.ok && "text-emerald-700 dark:text-emerald-400",
                    )}
                  >
                    {item.label}
                  </span>
                  {item.required && !item.ok && (
                    <span className="ml-1 text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400">
                      requerido
                    </span>
                  )}
                  <span className="ml-2 text-muted-foreground">{item.detail}</span>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-[11px] text-muted-foreground">
            <strong>Mínimo pra sintetizar:</strong> ≥1 transcript linkado{" "}
            <em>OU</em> ≥3 notas ativas. DS e Ops Info entram como contexto extra
            quando disponíveis (Vitoria já carrega automaticamente).
          </p>
        </div>
      </div>
    </div>
  );
}
