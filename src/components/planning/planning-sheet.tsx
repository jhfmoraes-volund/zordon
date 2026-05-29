"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
  ResponsiveSheetFooter,
} from "@/components/ui/responsive-sheet";
import { Field, FormBody } from "@/components/ui/field";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";

type SprintOption = {
  id: string;
  name: string;
  status: string;
};

type MemberOption = {
  id: string;
  name: string;
};

type ExistingPlanning = {
  id: string;
  sprintId: string | null;
  facilitatorId: string | null;
  scheduledFor: string | null;
  /** Determina wording do delete: em planejamento = hard delete; concluída/arquivada = arquivar. */
  phase?: "idle" | "reading" | "proposing" | "approving" | "closed" | "archived";
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Quando presente, sheet opera em modo edição. */
  planning?: ExistingPlanning | null;
  onCreate?: (sprintId: string | null) => Promise<void>;
  onUpdated?: () => void;
  onDeleted?: () => void;
  /** Quando presente, sobrescreve o DELETE interno — caller controla a chamada (ex: delete otimista numa lista). */
  onDelete?: () => Promise<void>;
  saving?: boolean;
};

export function PlanningSheet({
  open,
  onOpenChange,
  projectId,
  planning,
  onCreate,
  onUpdated,
  onDeleted,
  onDelete,
  saving = false,
}: Props) {
  const isEdit = !!planning;

  const [sprints, setSprints] = useState<SprintOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const [sprintId, setSprintId] = useState<string>("");
  const [facilitatorId, setFacilitatorId] = useState<string>("");
  const [scheduledFor, setScheduledFor] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const fetchOptions = useCallback(async () => {
    setLoadingOptions(true);
    try {
      const [sprintRes, memberRes] = await Promise.all([
        fetch(`/api/sprints?projectId=${projectId}&status=all`),
        fetch(`/api/projects/${projectId}/members`),
      ]);
      setSprints(sprintRes.ok ? await sprintRes.json() : []);
      setMembers(memberRes.ok ? (await memberRes.json()).map((m: { id: string; name: string }) => ({ id: m.id, name: m.name })) : []);
    } catch {
      setSprints([]);
      setMembers([]);
    } finally {
      setLoadingOptions(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    fetchOptions();
    if (planning) {
      setSprintId(planning.sprintId ?? "");
      setFacilitatorId(planning.facilitatorId ?? "");
      setScheduledFor(
        planning.scheduledFor
          ? planning.scheduledFor.slice(0, 10)
          : "",
      );
    } else {
      setSprintId("");
      setFacilitatorId("");
      setScheduledFor("");
    }
  }, [open, planning, fetchOptions]);

  const handleClose = () => {
    if (busy || saving) return;
    onOpenChange(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || saving) return;

    if (isEdit) {
      setBusy(true);
      try {
        await fetchOrThrow(`/api/planning/${planning!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sprintId: sprintId || null,
            facilitatorId: facilitatorId || null,
            scheduledFor: scheduledFor || null,
          }),
        });
        onOpenChange(false);
        onUpdated?.();
      } catch (err) {
        showErrorToast(err, { label: "Falha ao atualizar Planning" });
      } finally {
        setBusy(false);
      }
    } else {
      await onCreate?.(sprintId || null);
    }
  };

  // Em planejamento = hard delete (sumir do banco); concluída/arquivada = archive.
  // Backend decide; UI só ajusta wording. Phase ausente → assume hard delete
  // (callers que não passam phase são contextos de criação/edição cedo).
  const isArchive = planning?.phase === "closed" || planning?.phase === "archived";

  const handleDelete = () => {
    setConfirmState({
      title: isArchive ? "Arquivar Planning?" : "Excluir Planning?",
      description: isArchive
        ? "A planning será arquivada e removida da lista ativa. Histórico preservado pra auditoria."
        : "A planning será apagada permanentemente, junto com briefing notes, links de meetings e transcripts. Ações já aplicadas a tasks são preservadas. Essa ação é irreversível.",
      confirmLabel: isArchive ? "Arquivar" : "Excluir",
      destructive: true,
      onConfirm: async () => {
        if (onDelete) {
          await onDelete();
        } else {
          await fetchOrThrow(`/api/planning/${planning!.id}`, { method: "DELETE" });
        }
        onOpenChange(false);
        onDeleted?.();
      },
    });
  };

  const title = isEdit ? "Editar Planning" : "Nova Planning";
  const submitLabel = busy || saving ? (isEdit ? "Salvando…" : "Criando…") : (isEdit ? "Salvar" : "Criar Planning");

  return (
    <>
      <ResponsiveSheet open={open} onOpenChange={handleClose}>
        <ResponsiveSheetContent size="sm">
          <ResponsiveSheetHeader>
            <ResponsiveSheetTitle>{title}</ResponsiveSheetTitle>
          </ResponsiveSheetHeader>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <ResponsiveSheetBody>
              <FormBody density="comfortable">
                <Field name="sprintId">
                  <Field.Label>Sprint</Field.Label>
                  <Field.Control>
                    <select
                      id="sprintId"
                      value={sprintId}
                      onChange={(e) => setSprintId(e.target.value)}
                      disabled={loadingOptions}
                      className="flex h-[var(--field-h)] w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">— sem sprint —</option>
                      {sprints.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                          {s.status === "active" ? " (ativa)" : s.status === "upcoming" ? " (futura)" : ""}
                        </option>
                      ))}
                    </select>
                  </Field.Control>
                  <Field.Hint>Associa a planning a uma sprint do projeto.</Field.Hint>
                </Field>

                <Field name="facilitatorId">
                  <Field.Label>Facilitador</Field.Label>
                  <Field.Control>
                    <select
                      id="facilitatorId"
                      value={facilitatorId}
                      onChange={(e) => setFacilitatorId(e.target.value)}
                      disabled={loadingOptions}
                      className="flex h-[var(--field-h)] w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">— sem facilitador —</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </Field.Control>
                </Field>

                <Field name="scheduledFor">
                  <Field.Label>Data agendada</Field.Label>
                  <Field.Control>
                    <input
                      type="date"
                      id="scheduledFor"
                      value={scheduledFor}
                      onChange={(e) => setScheduledFor(e.target.value)}
                      className="flex h-[var(--field-h)] w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </Field.Control>
                </Field>
              </FormBody>

              {isEdit && (
                <div className="mt-6 pt-4 border-t">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                    onClick={handleDelete}
                    disabled={busy}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {isArchive ? "Arquivar Planning" : "Excluir Planning"}
                  </Button>
                </div>
              )}
            </ResponsiveSheetBody>

            <ResponsiveSheetFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={busy || saving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={busy || saving || loadingOptions}>
                {submitLabel}
              </Button>
            </ResponsiveSheetFooter>
          </form>
        </ResponsiveSheetContent>
      </ResponsiveSheet>

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
    </>
  );
}
