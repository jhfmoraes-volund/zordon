"use client";

/**
 * Histórico de alocação do contrato (MAH-006, D8) — side sheet admin-only.
 *
 * Mostra TODOS os períodos de alocação do contrato (vigentes, encerrados e
 * removidos), não só o roster atual. É a superfície de leitura + correção do
 * histórico que dirige a precificação:
 *   - Encerrar  → a pessoa saiu; seta effective_to (conta no billing até a data).
 *   - Remover (erro) → void soft: some do billing/roster, fica visível com o
 *     toggle "Mostrar removidos", reversível via Restaurar. Nada é apagado.
 *
 * Lê a TABELA via GET /api/finance/allocations?contractId= (inclui voided).
 */

import { useCallback, useEffect, useState } from "react";
import { Ban, History, RotateCcw, CalendarX } from "lucide-react";

import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
} from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { fmtDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { AllocationItem } from "@/lib/finance/types";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

type Status = "removido" | "agendado" | "alocado" | "encerrado";

// Eixo 1 (temporalidade) — derivado das datas vs hoje. effective_to no FUTURO
// NÃO é "encerrado": a pessoa está alocada até aquela data. effective_from no
// futuro = ainda nem começou (Agendado). Datas ISO (YYYY-MM-DD) comparam como string.
function statusOf(a: AllocationItem, today: string): Status {
  if (a.voided_at) return "removido";
  if (a.effective_from > today) return "agendado";
  if (!a.effective_to || a.effective_to >= today) return "alocado";
  return "encerrado";
}

export function FinanceAllocationHistorySheet({
  open,
  onOpenChange,
  contractId,
  contractLabel,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: string;
  contractLabel: string;
  /** Bubble pro hub recarregar (roster/billing mudam com encerrar/remover). */
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<AllocationItem[] | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // Sem setState síncrono: só seta `rows` no callback pós-await. O reset de
  // showRemoved/voidingId vem de graça porque o parent remonta via key (1 sheet
  // por contrato), igual ao FinanceContractSheet/InvoiceSheet.
  const load = useCallback(async () => {
    try {
      const res = await fetchOrThrow(
        `/api/finance/allocations?contractId=${encodeURIComponent(contractId)}`,
      );
      const data = (await res.json()) as { allocations: AllocationItem[] };
      setRows(data.allocations ?? []);
    } catch (e) {
      showErrorToast(e, { label: "Falha ao carregar histórico" });
      setRows([]);
    }
  }, [contractId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function act(id: string, run: () => Promise<Response>) {
    setBusyId(id);
    try {
      await run();
      await load();
      onChanged?.();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao atualizar alocação" });
    } finally {
      setBusyId(null);
    }
  }

  function close(a: AllocationItem) {
    setConfirm({
      title: `Encerrar alocação de ${a.memberName}?`,
      description: `Marca a saída em ${fmtDate(todayISO())}. O período fica preservado no histórico e conta no billing até essa data.`,
      confirmLabel: "Encerrar",
      onConfirm: () =>
        act(a.id, () =>
          fetchOrThrow(`/api/finance/allocations/${a.id}/close`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ effectiveTo: todayISO() }),
          }),
        ),
    });
  }

  function restore(a: AllocationItem) {
    setConfirm({
      title: `Restaurar alocação de ${a.memberName}?`,
      description: "Volta a valer no billing e no roster.",
      confirmLabel: "Restaurar",
      onConfirm: () =>
        act(a.id, () =>
          fetchOrThrow(`/api/finance/allocations/${a.id}/restore`, { method: "POST" }),
        ),
    });
  }

  async function confirmVoid(a: AllocationItem) {
    if (!voidReason.trim()) return;
    await act(a.id, () =>
      fetchOrThrow(`/api/finance/allocations/${a.id}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: voidReason.trim() }),
      }),
    );
    setVoidingId(null);
    setVoidReason("");
  }

  const visible = (rows ?? []).filter((a) => showRemoved || !a.voided_at);
  const removedCount = (rows ?? []).filter((a) => a.voided_at).length;

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="lg">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle className="flex items-center gap-2">
            <History className="size-4" /> Histórico de alocação
          </ResponsiveSheetTitle>
          <p className="truncate text-xs text-muted-foreground">{contractLabel}</p>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          {/* Toggle de removidos */}
          {removedCount > 0 && (
            <label className="mb-3 flex cursor-pointer select-none items-center justify-end gap-2 text-sm text-muted-foreground">
              <Switch checked={showRemoved} onCheckedChange={setShowRemoved} />
              Mostrar removidos ({removedCount})
            </label>
          )}

          {rows === null ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-md border px-3 py-8 text-center text-sm text-muted-foreground">
              Nenhuma alocação neste contrato.
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map((a) => {
                const st = statusOf(a, todayISO());
                const removed = st === "removido";
                const isBusy = busyId === a.id;
                return (
                  <div
                    key={a.id}
                    className={cn(
                      "rounded-lg border p-3 transition-colors",
                      removed && "opacity-70",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "flex items-center gap-2 text-sm font-medium",
                            removed && "line-through",
                          )}
                        >
                          {a.memberName}
                          {a.kind === "spot" && (
                            <Badge variant="outline" className="text-[10px]">
                              pontual
                            </Badge>
                          )}
                        </p>
                        <p
                          className={cn(
                            "text-xs text-muted-foreground",
                            removed && "line-through",
                          )}
                        >
                          {a.kind === "spot" ? `${a.days}d` : `${a.percent}%`} ·{" "}
                          {fmtDate(a.effective_from)} →{" "}
                          {a.effective_to ? fmtDate(a.effective_to) : "vigente"}
                        </p>
                        {removed && a.voided_reason && (
                          <p className="mt-1 text-xs text-rose-500">
                            removido (erro): {a.voided_reason}
                          </p>
                        )}
                      </div>
                      <StatusChip status={st} />
                    </div>

                    {/* Ações */}
                    {voidingId === a.id ? (
                      <div className="mt-3 space-y-2 border-t pt-3">
                        <Textarea
                          autoFocus
                          rows={2}
                          value={voidReason}
                          onChange={(e) => setVoidReason(e.target.value)}
                          placeholder="Motivo da remoção (ex: membro errado, % digitado errado)…"
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setVoidingId(null);
                              setVoidReason("");
                            }}
                            disabled={isBusy}
                          >
                            Cancelar
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => confirmVoid(a)}
                            disabled={isBusy || !voidReason.trim()}
                          >
                            {isBusy ? "Removendo…" : "Confirmar remoção"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-wrap justify-end gap-2">
                        {removed ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => restore(a)}
                            disabled={isBusy}
                          >
                            <RotateCcw className="size-3.5" /> Restaurar
                          </Button>
                        ) : (
                          <>
                            {st === "alocado" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => close(a)}
                                disabled={isBusy}
                              >
                                <CalendarX className="size-3.5" /> Encerrar
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => {
                                setVoidingId(a.id);
                                setVoidReason("");
                              }}
                              disabled={isBusy}
                            >
                              <Ban className="size-3.5" /> Remover (erro)
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Encerrar = a pessoa esteve e saiu (conta no billing até a data). Remover =
            o lançamento foi erro (sai do billing, fica como histórico). Nada é
            apagado de verdade — toda correção é reversível.
          </p>
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </ResponsiveSheet>
  );
}

function StatusChip({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    agendado: { label: "Agendado", cls: "border-sky-500/40 text-sky-600" },
    alocado: { label: "Alocado", cls: "border-emerald-500/40 text-emerald-600" },
    encerrado: { label: "Encerrado", cls: "border-muted-foreground/40 text-muted-foreground" },
    removido: { label: "Removido", cls: "border-rose-500/40 text-rose-500" },
  };
  const s = map[status];
  return (
    <Badge variant="outline" className={cn("shrink-0 text-[10px]", s.cls)}>
      {s.label}
    </Badge>
  );
}
