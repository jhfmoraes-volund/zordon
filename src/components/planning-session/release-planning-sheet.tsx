"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Loader2,
  Trash2,
} from "lucide-react";
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
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";

type MemberOption = { id: string; name: string };

type ExistingReleasePlanning = {
  id: string;
  facilitatorId: string | null;
  /** approved → read-only/wording de delete. */
  status?: string;
};

/** Estado da grade de sprints do contrato — deriva de UM dryRun do generate-sprints. */
type SprintPlan =
  | { status: "loading" }
  | { status: "no-dates" }
  | { status: "error" }
  | {
      status: "ready";
      totalWeeks: number;
      existingInWindow: number;
      count: number;
      firstStart: string | null;
      lastStart: string | null;
      pastHoles: number;
      willActivateCurrentWeek: boolean;
    };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** Quando presente, sheet opera em modo edição. */
  planning?: ExistingReleasePlanning | null;
  onCreate?: (input: { facilitatorId: string | null }) => Promise<void>;
  onUpdated?: () => void;
  onDeleted?: () => void;
  /** Sprints foram geradas aqui → quem renderiza o cronograma pode recarregar. */
  onSprintsGenerated?: () => void;
  saving?: boolean;
};

function fmtDayMonth(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

export function ReleasePlanningSheet({
  open,
  onOpenChange,
  projectId,
  planning,
  onCreate,
  onUpdated,
  onDeleted,
  onSprintsGenerated,
  saving = false,
}: Props) {
  const isEdit = !!planning;
  const router = useRouter();
  const { member: currentMember } = useAuth();

  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  const [facilitatorId, setFacilitatorId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [plan, setPlan] = useState<SprintPlan>({ status: "loading" });

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

  // Prontidão: o Planning é contínuo e lê as sprints do contrato. UM dryRun do
  // generate-sprints diz tudo — 422 = projeto sem prazo; senão, cobertura da grade.
  const loadSprintPlan = useCallback(async () => {
    setPlan({ status: "loading" });
    try {
      const res = await fetchOrThrow(`/api/projects/${projectId}/generate-sprints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const p = await res.json();
      setPlan({
        status: "ready",
        totalWeeks: p.totalWeeks ?? 0,
        existingInWindow: p.existingInWindow ?? 0,
        count: p.count ?? 0,
        firstStart: p.firstStart ?? null,
        lastStart: p.lastStart ?? null,
        pastHoles: p.pastHoles ?? 0,
        willActivateCurrentWeek: !!p.willActivateCurrentWeek,
      });
    } catch (e) {
      const status = (e as { status?: number })?.status;
      setPlan({ status: status === 422 ? "no-dates" : "error" });
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    fetchOptions();
    void loadSprintPlan();
    setFacilitatorId(planning ? planning.facilitatorId ?? "" : currentMember?.id ?? "");
  }, [open, planning, fetchOptions, loadSprintPlan, currentMember?.id]);

  const handleClose = () => {
    if (busy || saving) return;
    onOpenChange(false);
  };

  const goSetDates = () => {
    onOpenChange(false);
    router.push(`/projects/${projectId}?edit=project`);
  };

  // Gera a grade do contrato: dryRun → ConfirmDialog com preview → POST de verdade.
  const handleGenerateSprints = useCallback(async () => {
    try {
      const res = await fetchOrThrow(`/api/projects/${projectId}/generate-sprints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const p = await res.json();
      if (!p.count) {
        toast.info(
          p.pastHoles > 0
            ? "Nada a criar daqui pra frente — só restam semanas passadas sem sprint (não são criadas retroativamente)."
            : "Todas as semanas do prazo já têm sprint.",
        );
        await loadSprintPlan();
        return;
      }
      const parts = [
        `Cria ${p.count} ${p.count > 1 ? "sprints semanais" : "sprint semanal"} (seg→dom), de ${fmtDayMonth(p.firstStart)} até ${fmtDayMonth(p.lastStart)}, cobrindo o prazo do projeto.`,
      ];
      if (p.willActivateCurrentWeek) parts.push("A sprint da semana atual será ativada.");
      if (p.pastHoles > 0) {
        parts.push(
          `${p.pastHoles} semana${p.pastHoles > 1 ? "s" : ""} passada${p.pastHoles > 1 ? "s" : ""} sem sprint fica${p.pastHoles > 1 ? "m" : ""} de fora (sem backfill).`,
        );
      }
      setConfirmState({
        title: "Criar sprints até o fim do prazo?",
        description: parts.join(" "),
        confirmLabel: "Criar sprints",
        onConfirm: async () => {
          try {
            const execRes = await fetchOrThrow(
              `/api/projects/${projectId}/generate-sprints`,
              { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) },
            );
            const r = await execRes.json();
            toast.success(r.created === 1 ? "1 sprint criada" : `${r.created} sprints criadas`);
            await loadSprintPlan();
            onSprintsGenerated?.();
          } catch (err) {
            showErrorToast(err, { label: "Falha ao gerar sprints" });
          }
        },
      });
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 422) {
        toast.error("Projeto sem prazo definido. Defina início e fim do projeto primeiro.");
      } else {
        showErrorToast(e, { label: "Falha ao calcular sprints do prazo" });
      }
    }
  }, [projectId, loadSprintPlan, onSprintsGenerated]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || saving) return;

    if (isEdit) {
      setBusy(true);
      try {
        await fetchOrThrow(`/api/planning-sessions/${planning!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ facilitatorId: facilitatorId || null }),
        });
        onOpenChange(false);
        onUpdated?.();
      } catch (err) {
        showErrorToast(err, { label: "Falha ao atualizar Planning" });
      } finally {
        setBusy(false);
      }
    } else {
      await onCreate?.({ facilitatorId: facilitatorId || null });
    }
  };

  const handleDelete = () => {
    setConfirmState({
      title: "Excluir Planning?",
      description:
        "O planning será apagado permanentemente, junto com os PRDs alocados e insumos linkados. Os ProductRequirements do projeto são preservados. Ação irreversível.",
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

  const title = isEdit ? "Editar Planning" : "Novo Planning";
  const submitLabel =
    busy || saving
      ? isEdit
        ? "Salvando…"
        : "Criando…"
      : isEdit
        ? "Salvar"
        : "Criar Planning";

  // Sem nenhuma sprint na grade → cronograma fica vazio. Nudge forte (não trava).
  const noGrid = plan.status === "ready" && plan.existingInWindow === 0;

  return (
    <>
      <ResponsiveSheet open={open} onOpenChange={handleClose}>
        <ResponsiveSheetContent size="sm">
          <ResponsiveSheetHeader>
            <ResponsiveSheetTitle>{title}</ResponsiveSheetTitle>
          </ResponsiveSheetHeader>

          <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
            <ResponsiveSheetBody className="space-y-5">
              {/* ── Prontidão: prazo do contrato → grade de sprints ── */}
              <section className="rounded-lg border bg-muted/30 p-3 space-y-3">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Prontidão do contrato
                </div>

                {plan.status === "loading" && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Checando o prazo do projeto…
                  </p>
                )}

                {plan.status === "no-dates" && (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 text-sm">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                      <div>
                        <p className="font-medium">Defina o prazo do projeto.</p>
                        <p className="text-xs text-muted-foreground">
                          O Planning é contínuo e lê as sprints do contrato. Sem
                          início e fim do projeto não dá pra montar o cronograma.
                        </p>
                      </div>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={goSetDates}>
                      <CalendarDays className="size-3.5" />
                      Definir prazo do projeto
                    </Button>
                  </div>
                )}

                {plan.status === "error" && (
                  <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                    Não consegui checar a grade de sprints agora.
                    <Button type="button" variant="ghost" size="sm" onClick={() => void loadSprintPlan()}>
                      Tentar de novo
                    </Button>
                  </div>
                )}

                {plan.status === "ready" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      {plan.count === 0 ? (
                        <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                      ) : (
                        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span>
                        Contrato: <b className="tabular-nums">{plan.totalWeeks}</b> semanas ·{" "}
                        <b className="tabular-nums">{plan.existingInWindow}</b> com sprint
                        {plan.count > 0 && (
                          <>
                            {" "}
                            · <span className="text-amber-600 tabular-nums">{plan.count} a gerar</span>
                          </>
                        )}
                      </span>
                    </div>

                    {plan.count > 0 ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant={noGrid ? "default" : "outline"}
                          onClick={() => void handleGenerateSprints()}
                          className="gap-1.5"
                        >
                          <CalendarDays className="size-3.5" />
                          Sprints do prazo
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          Cria as sprints semanais (seg→dom) do prazo de uma vez.
                          Confira o início e fim do projeto antes — datas erradas
                          geram a grade errada.
                        </p>
                        {noGrid && !isEdit && (
                          <p className="text-xs text-amber-600">
                            Dá pra criar o Planning agora, mas o cronograma fica vazio
                            até gerar as sprints.
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-emerald-600">
                        Grade completa — todas as semanas do prazo têm sprint.
                      </p>
                    )}
                  </div>
                )}
              </section>

              {/* ── Config mínima ── */}
              <FormBody density="comfortable">
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
                  <Field.Hint>Quem conduz o Planning do projeto.</Field.Hint>
                </Field>
              </FormBody>

              {isEdit && (
                <div className="mt-2 pt-4 border-t">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                    onClick={handleDelete}
                    disabled={busy}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Excluir Planning
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
