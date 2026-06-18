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
import { DatePicker } from "@/components/ui/date-picker";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { useAuth } from "@/contexts/auth-context";

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const SPRINT_COUNT_OPTIONS = [2, 3, 4, 5, 6, 8, 10, 12];

type MemberOption = { id: string; name: string };

type ExistingReleasePlanning = {
  id: string;
  facilitatorId: string | null;
  scheduledFor: string | null;
  sprintCount: number;
  /** approved → read-only/wording de delete. */
  status?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Quando presente, sheet opera em modo edição. */
  planning?: ExistingReleasePlanning | null;
  onCreate?: (input: {
    facilitatorId: string | null;
    scheduledFor: string | null;
    sprintCount: number;
  }) => Promise<void>;
  onUpdated?: () => void;
  onDeleted?: () => void;
  saving?: boolean;
};

export function ReleasePlanningSheet({
  open,
  onOpenChange,
  projectId,
  planning,
  onCreate,
  onUpdated,
  onDeleted,
  saving = false,
}: Props) {
  const isEdit = !!planning;
  const { member: currentMember } = useAuth();

  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const [facilitatorId, setFacilitatorId] = useState<string>("");
  const [scheduledFor, setScheduledFor] = useState<string>("");
  const [sprintCount, setSprintCount] = useState<number>(6);
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
    /* eslint-disable react-hooks/set-state-in-effect -- intentional: inicializa o form state quando o sheet abre / muda de alvo */
    fetchOptions();
    if (planning) {
      setFacilitatorId(planning.facilitatorId ?? "");
      setScheduledFor(planning.scheduledFor ? planning.scheduledFor.slice(0, 10) : "");
      setSprintCount(planning.sprintCount ?? 6);
    } else {
      setFacilitatorId(currentMember?.id ?? "");
      setScheduledFor(todayISO());
      setSprintCount(6);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, planning, fetchOptions, currentMember?.id]);

  const handleClose = () => {
    if (busy || saving) return;
    onOpenChange(false);
  };

  // ISO date (YYYY-MM-DD) → ISO datetime (meia-noite local) pra coluna timestamptz.
  const scheduledForIso = scheduledFor
    ? new Date(`${scheduledFor}T00:00:00`).toISOString()
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || saving) return;

    if (isEdit) {
      setBusy(true);
      try {
        await fetchOrThrow(`/api/planning-sessions/${planning!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            facilitatorId: facilitatorId || null,
            scheduledFor: scheduledForIso,
            sprintCount,
          }),
        });
        onOpenChange(false);
        onUpdated?.();
      } catch (err) {
        showErrorToast(err, { label: "Falha ao atualizar Release Planning" });
      } finally {
        setBusy(false);
      }
    } else {
      await onCreate?.({
        facilitatorId: facilitatorId || null,
        scheduledFor: scheduledForIso,
        sprintCount,
      });
    }
  };

  const handleDelete = () => {
    setConfirmState({
      title: "Excluir Release Planning?",
      description:
        "O release planning será apagado permanentemente, junto com os PRDs alocados e insumos linkados. Os ProductRequirements do projeto são preservados. Ação irreversível.",
      confirmLabel: "Excluir",
      destructive: true,
      onConfirm: async () => {
        await fetchOrThrow(`/api/planning-sessions/${planning!.id}`, {
          method: "DELETE",
        });
        onOpenChange(false);
        onDeleted?.();
      },
    });
  };

  const title = isEdit ? "Editar Release Planning" : "Novo Release Planning";
  const submitLabel =
    busy || saving
      ? isEdit
        ? "Salvando…"
        : "Criando…"
      : isEdit
        ? "Salvar"
        : "Criar Release Planning";

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
                <Field name="sprintCount">
                  <Field.Label>Número de sprints</Field.Label>
                  <Field.Control>
                    <select
                      id="sprintCount"
                      value={sprintCount}
                      onChange={(e) => setSprintCount(Number(e.target.value))}
                      className="flex h-[var(--field-h)] w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {SPRINT_COUNT_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n} sprints
                        </option>
                      ))}
                    </select>
                  </Field.Control>
                  <Field.Hint>Largura do board de release.</Field.Hint>
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

                <Field name="scheduledFor">
                  <Field.Label>Data agendada</Field.Label>
                  <Field.Control>
                    <DatePicker
                      data-slot="button"
                      clearable
                      value={scheduledFor}
                      onChange={setScheduledFor}
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
                    Excluir Release Planning
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
