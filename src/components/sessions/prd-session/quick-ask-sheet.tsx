"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetDescription,
  ResponsiveSheetBody,
  ResponsiveSheetFooter,
} from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormBody } from "@/components/ui/field";
import { InsumosButton } from "@/components/agent/context-import/insumos-button";
import { DesignSessionContextSheet } from "@/components/design-session/design-session-context-sheet";
import { showErrorToast } from "@/lib/optimistic/toast";

/**
 * PRD Quick-Ask Launcher (QAL-004).
 *
 * Mesma casca de antes (ResponsiveSheet size=lg), papel novo: coleta insumos +
 * brief opcional e ao confirmar joga o PM no chat onde o Vitor faz a 1ª análise.
 *
 * Ciclo de vida draft-no-open (D13):
 *   abrir  → POST /draft  (cria session draft; insumos linkam ao vivo nela)
 *   OK     → PATCH /finalize (valida brief OU insumo) → navega pro chat
 *   cancel → DELETE /[sessionId] (limpa draft)
 */
export function PrdQuickAskSheet({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [brief, setBrief] = useState("");
  const [insumosOpen, setInsumosOpen] = useState(false);
  const [insumosCount, setInsumosCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Guards: evita criar 2 drafts (StrictMode/re-render); marca finalize pra não
  // deletar a session ao fechar a sheet na navegação.
  const draftRequestedRef = useRef(false);
  const finalizedRef = useRef(false);

  // Cria a session draft assim que a sheet abre.
  useEffect(() => {
    if (!open || sessionId || draftRequestedRef.current) return;
    draftRequestedRef.current = true;

    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/sessions/prd/quick-ask/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || "Falha ao iniciar o Quick-Ask");
        }
        const { sessionId: sid } = (await res.json()) as { sessionId: string };
        if (active) setSessionId(sid);
      } catch (err) {
        showErrorToast(err, { label: "Quick-Ask PRD" });
        draftRequestedRef.current = false;
        if (active) onOpenChange(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [open, sessionId, projectId, onOpenChange]);

  const reset = () => {
    setSessionId(null);
    setBrief("");
    setInsumosCount(0);
    setInsumosOpen(false);
    draftRequestedRef.current = false;
    finalizedRef.current = false;
  };

  // Fechar sem finalizar → deleta a draft (e reseta pra próxima abertura).
  const handleOpenChange = (next: boolean) => {
    if (!next && sessionId && !finalizedRef.current) {
      const sid = sessionId;
      void fetch(`/api/sessions/prd/quick-ask/${sid}`, {
        method: "DELETE",
      }).catch(() => {});
      reset();
    }
    onOpenChange(next);
  };

  const canSubmit = insumosCount >= 1 || brief.trim().length >= 10;

  const handleSubmit = async () => {
    if (!sessionId || !canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/sessions/prd/quick-ask/${sessionId}/finalize`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brief: brief.trim() || undefined }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Falha ao criar a sessão");
      }
      finalizedRef.current = true;
      const sid = sessionId;
      onOpenChange(false);
      // Rota canônica da PRD Session: step prd_briefing é índice 0.
      router.push(`/design-sessions/${sid}/steps/0`);
    } catch (err) {
      showErrorToast(err, { label: "Quick-Ask PRD" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <ResponsiveSheet open={open} onOpenChange={handleOpenChange}>
        <ResponsiveSheetContent size="lg">
          <ResponsiveSheetHeader>
            <ResponsiveSheetTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              PRD Quick-Ask com Vitor
            </ResponsiveSheetTitle>
            <ResponsiveSheetDescription>
              Importe insumos e/ou descreva a ideia. Vitor faz a primeira análise no chat.
            </ResponsiveSheetDescription>
          </ResponsiveSheetHeader>

          <ResponsiveSheetBody>
            <FormBody density="comfortable">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  Insumos — reuniões, planilhas, GitHub
                </span>
                <InsumosButton
                  count={insumosCount}
                  onClick={() => setInsumosOpen(true)}
                  disabled={!sessionId || submitting}
                />
              </div>

              <Field name="brief">
                <Field.Label>Descreva sua ideia (opcional)</Field.Label>
                <Field.Control>
                  <Textarea
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    placeholder="Ex: foca no módulo de agendamento e pagamentos…"
                    rows={6}
                    disabled={submitting}
                  />
                </Field.Control>
                <Field.Hint>
                  Opcional se você anexar insumos. Se preencher, mínimo 10 caracteres.
                </Field.Hint>
              </Field>
            </FormBody>
          </ResponsiveSheetBody>

          <ResponsiveSheetFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting || !sessionId}
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              Criar e abrir chat
            </Button>
          </ResponsiveSheetFooter>
        </ResponsiveSheetContent>
      </ResponsiveSheet>

      {sessionId && (
        <DesignSessionContextSheet
          sessionId={sessionId}
          projectId={projectId}
          open={insumosOpen}
          onOpenChange={setInsumosOpen}
          ritualLabel="PRD"
          onCountChange={setInsumosCount}
        />
      )}
    </>
  );
}
