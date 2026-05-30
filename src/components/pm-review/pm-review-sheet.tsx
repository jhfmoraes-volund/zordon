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
import { useAuth } from "@/contexts/auth-context";

type MemberOption = { id: string; name: string };

type ExistingPMReview = {
  id: string;
  facilitatorId: string | null;
  scheduledFor: string | null;
  referenceWeek: string; // YYYY-MM-DD
  status?: "draft" | "published" | "archived";
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Quando presente, sheet opera em modo edição. */
  pmReview?: ExistingPMReview | null;
  onCreate?: (referenceWeek: string, facilitatorId: string | null) => Promise<void>;
  onUpdated?: () => void;
  onDeleted?: () => void;
  /** Sobrescreve DELETE interno (callers podem fazer delete otimista). */
  onDelete?: () => Promise<void>;
  saving?: boolean;
};

/** Pega a segunda da semana de uma data. ISO local-safe. */
function mondayOfLocal(d: Date): string {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = out.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  out.setDate(out.getDate() + diff);
  const yyyy = out.getFullYear();
  const mm = String(out.getMonth() + 1).padStart(2, "0");
  const dd = String(out.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function PMReviewSheet({
  open,
  onOpenChange,
  projectId,
  pmReview,
  onCreate,
  onUpdated,
  onDeleted,
  onDelete,
  saving = false,
}: Props) {
  const isEdit = !!pmReview;

  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const [referenceWeek, setReferenceWeek] = useState<string>("");
  const [facilitatorId, setFacilitatorId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const fetchOptions = useCallback(async () => {
    setLoadingOptions(true);
    try {
      const memberRes = await fetch(`/api/projects/${projectId}/members`);
      setMembers(
        memberRes.ok
          ? (await memberRes.json()).map((m: { id: string; name: string }) => ({
              id: m.id,
              name: m.name,
            }))
          : [],
      );
    } catch {
      setMembers([]);
    } finally {
      setLoadingOptions(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    fetchOptions();
    if (pmReview) {
      setReferenceWeek(pmReview.referenceWeek);
      setFacilitatorId(pmReview.facilitatorId ?? "");
    } else {
      setReferenceWeek(mondayOfLocal(new Date()));
      setFacilitatorId("");
    }
  }, [open, pmReview, fetchOptions]);

  function handleWeekChange(raw: string) {
    if (!raw) {
      setReferenceWeek("");
      return;
    }
    // Snap pra segunda da semana selecionada — UX clara que o campo é semanal.
    const d = new Date(raw + "T00:00:00");
    setReferenceWeek(mondayOfLocal(d));
  }

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
        await fetchOrThrow(`/api/pm-review/${pmReview!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            referenceWeek: referenceWeek || null,
            facilitatorId: facilitatorId || null,
          }),
        });
        onOpenChange(false);
        onUpdated?.();
      } catch (err) {
        showErrorToast(err, { label: "Falha ao atualizar PM Review" });
      } finally {
        setBusy(false);
      }
    } else {
      await onCreate?.(referenceWeek, facilitatorId || null);
    }
  };

  const isArchive =
    pmReview?.status === "published" || pmReview?.status === "archived";

  const handleDelete = () => {
    setConfirmState({
      title: isArchive ? "Arquivar PM Review?" : "Excluir PM Review?",
      description: isArchive
        ? "O PM Review será arquivado e removido da lista ativa. Histórico preservado."
        : "O PM Review e suas notes/links serão apagados permanentemente. Ação irreversível.",
      confirmLabel: isArchive ? "Arquivar" : "Excluir",
      destructive: true,
      onConfirm: async () => {
        if (onDelete) {
          await onDelete();
        } else if (isArchive) {
          await fetchOrThrow(`/api/pm-review/${pmReview!.id}/archive`, {
            method: "POST",
          });
        } else {
          await fetchOrThrow(`/api/pm-review/${pmReview!.id}`, {
            method: "DELETE",
          });
        }
        onOpenChange(false);
        onDeleted?.();
      },
    });
  };

  const title = isEdit ? "Editar PM Review" : "Novo PM Review";
  const submitLabel =
    busy || saving
      ? isEdit
        ? "Salvando…"
        : "Criando…"
      : isEdit
        ? "Salvar"
        : "Criar PM Review";

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
                <Field name="referenceWeek" required>
                  <Field.Label>Semana de referência</Field.Label>
                  <Field.Control>
                    <input
                      type="date"
                      id="referenceWeek"
                      value={referenceWeek}
                      onChange={(e) => handleWeekChange(e.target.value)}
                      className="flex h-[var(--field-h)] w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </Field.Control>
                  <Field.Hint>
                    A data será ajustada pra segunda-feira da semana selecionada.
                  </Field.Hint>
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
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
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
                    {isArchive ? "Arquivar PM Review" : "Excluir PM Review"}
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
              <Button
                type="submit"
                disabled={busy || saving || loadingOptions || !referenceWeek}
              >
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
