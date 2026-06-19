"use client";

// ProposalShell — wraps the rich TaskSheetInner (or a small action-specific
// view) with a yellow proposal banner on top and decision buttons on the
// bottom. Used in MeetingTaskActionSheet v2 so the editing surface for an
// in-meeting proposal looks identical to the project page, with proposal-
// specific affordances bolted on.

import { useState } from "react";
import { ChevronRight, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { ACTION_TYPE, lookupChip } from "@/lib/status-chips";
import type { MeetingTaskAction } from "./meeting-task-action-sheet";
import { showErrorToast } from "@/lib/optimistic/toast";

const ACTION_LONG_LABEL: Record<MeetingTaskAction["type"], string> = {
  create: "Criar",
  update: "Atualizar",
  delete: "Remover da sprint",
  move: "Mover sprint",
  review: "Revisar",
};

export type ProposalDecisionPayload = {
  /** Whatever buffered the user accumulated for the proposal (payload v2). */
  payload?: Record<string, unknown>;
  targetSprintId?: string | null;
  reviewReasons?: string[];
  reviewNote?: string;
  notes?: string;
  /** Did the user actually edit any field locally before approving? */
  wasEdited?: boolean;
};

export type ProposalShellProps = {
  action: MeetingTaskAction;
  meetingId?: string;
  /** Override completo da URL de decisão (ex: para planning). */
  decisionUrl?: string;
  /** Local buffer that the caller manages. Returned to the API on Aprovar. */
  buildDecisionPayload: () => ProposalDecisionPayload;
  /** True while the inner view is still loading project context. */
  loading?: boolean;
  onClose: () => void;
  /** Notify parent so it can refresh the action list. */
  onChange?: () => void;
  children: React.ReactNode;
};

export function ProposalShell({
  action,
  meetingId,
  decisionUrl,
  buildDecisionPayload,
  loading,
  onClose,
  onChange,
  children,
}: ProposalShellProps) {
  const [busy, setBusy] = useState(false);
  // Explicação da IA fica colapsada por default — é longa e o PM normalmente já
  // decide pelo título/chip; expande sob demanda.
  const [reasoningOpen, setReasoningOpen] = useState(false);

  const putAction = async (
    body: Record<string, unknown>,
    errorLabel: string,
    closeOnSuccess: boolean,
  ) => {
    setBusy(true);
    try {
      const url = decisionUrl ?? `/api/meetings/${meetingId}/task-actions/${action.id}`;
      const res = await fetch(
        url,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new Error(await res.text());
      onChange?.();
      if (closeOnSuccess) onClose();
    } catch (e) {
      console.error("putAction failed:", e);
      showErrorToast(e, { label: errorLabel });
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: "approved" | "rejected") => {
    const body: Record<string, unknown> = { decision };
    if (decision === "approved") {
      Object.assign(body, buildDecisionPayload());
    }
    await putAction(body, "Falha ao registrar decisão", true);
  };

  /** Save proposal edits (payload + target/review) without changing decision.
   *  Used while a manual proposal is approved-but-not-applied: PM still owns
   *  it and can keep editing until "Aplicar plano" runs. */
  const saveDraft = async () => {
    const built = buildDecisionPayload();
    await putAction(built, "Falha ao salvar alterações", true);
  };

  // Editing the proposal payload is allowed while the action is still
  // actionable (not yet applied to the real Task and not rejected).
  const isEditable =
    action.execution === "pending" && action.decision !== "rejected";
  const isApprovedDraft =
    action.decision === "approved" && action.execution === "pending";

  const actionChip = lookupChip(ACTION_TYPE, action.type);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Proposal banner */}
      <div className="shrink-0 border-b bg-amber-50 px-6 py-3 dark:bg-amber-500/10">
        <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-400">
          {action.source === "ai" ? (
            <Sparkles className="h-3.5 w-3.5" />
          ) : (
            <Wand2 className="h-3.5 w-3.5" />
          )}
          <span className="font-medium uppercase tracking-wide">
            Proposta de {ACTION_LONG_LABEL[action.type]} ·{" "}
            {action.source === "ai" ? "Sugestão da IA" : "Manual"}
          </span>
          <StatusChip tone={actionChip.tone} label={actionChip.label} />
          {action.source === "ai" && action.aiConfidence != null && (
            <span className="ml-auto text-amber-700/70">
              conf {(action.aiConfidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
        {action.aiReasoning && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => setReasoningOpen((o) => !o)}
              className="flex items-center gap-1 text-xs font-medium text-amber-800/80 hover:text-amber-900 dark:text-amber-300/80 dark:hover:text-amber-200"
              aria-expanded={reasoningOpen}
            >
              <ChevronRight
                className={`h-3 w-3 transition-transform ${reasoningOpen ? "rotate-90" : ""}`}
              />
              {reasoningOpen ? "Ocultar explicação" : "Ver explicação"}
            </button>
            {reasoningOpen && (
              <p className="mt-1.5 text-sm text-amber-900 dark:text-amber-200/90">
                {action.aiReasoning}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Carregando contexto…
          </div>
        ) : (
          children
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 flex items-center justify-end gap-2 border-t bg-popover px-6 py-3">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Fechar
        </Button>
        {isEditable && action.decision !== "rejected" && (
          <Button
            variant="destructive"
            onClick={() => decide("rejected")}
            disabled={busy}
          >
            Rejeitar
          </Button>
        )}
        {isEditable && action.decision === "pending" && (
          <Button onClick={() => decide("approved")} disabled={busy}>
            Aprovar
          </Button>
        )}
        {isApprovedDraft && (
          <Button onClick={saveDraft} disabled={busy}>
            Salvar alterações
          </Button>
        )}
      </div>
    </div>
  );
}
