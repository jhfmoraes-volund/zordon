"use client";

/**
 * App Férias & Folgas (Overview, manager-only). Calendário membro × dia do mês,
 * saldo de férias (PJ úteis / CLT corridos) e banco de horas (folga 1.5×). PM vê
 * e edita só o próprio squad (RLS); admin vê todos e define o regime PJ/CLT.
 *
 * Dado agregado (saldos calculados no server) → muta e refaz o fetch, em vez de
 * otimismo client-side que arriscaria divergir do saldo. Erros via Sonner.
 */

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import type { AccessLevel } from "@/lib/roles";
import type { ContractType, FeriasData, TimeOff } from "@/lib/ferias/types";

import { FeriasCalendarMatrix } from "./ferias-calendar-matrix";
import { FeriasEntrySheet } from "./ferias-entry-sheet";
import { CompTimeSheet } from "./comp-time-sheet";

type EntrySheet = {
  open: boolean;
  entry?: TimeOff | null;
  presetMemberId?: string | null;
  presetDate?: string | null;
};

export function FeriasApp({ accessLevel }: { accessLevel: AccessLevel }) {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth()); // 0-11
  const [data, setData] = useState<FeriasData | null>(null);
  const [entrySheet, setEntrySheet] = useState<EntrySheet>({ open: false });
  const [compOpen, setCompOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const fetchData = useCallback(async (): Promise<FeriasData | null> => {
    try {
      const res = await fetchOrThrow(`/api/ferias?year=${year}`);
      return (await res.json()) as FeriasData;
    } catch (e) {
      showErrorToast(e, { label: "Falha ao carregar férias" });
      return null;
    }
  }, [year]);

  useEffect(() => {
    let cancelled = false;
    fetchData().then((d) => {
      if (!cancelled && d) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchData]);

  const reload = useCallback(async () => {
    const d = await fetchData();
    if (d) setData(d);
  }, [fetchData]);

  const members = data?.members ?? [];
  // Entradas que tocam o mês visível (a matriz resolve dia a dia).
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthTimeOff = (data?.timeOff ?? []).filter(
    (t) => t.startDate.slice(0, 7) <= monthKey && t.endDate.slice(0, 7) >= monthKey,
  );

  function stepMonth(delta: number) {
    const d = new Date(Date.UTC(year, month + delta, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth());
  }

  const monthLabel = new Date(Date.UTC(year, month, 1)).toLocaleDateString(
    "pt-BR",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  async function changeContractType(memberId: string, ct: ContractType | null) {
    try {
      await fetchOrThrow(`/api/ferias/member/${memberId}/contract-type`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractType: ct }),
      });
      void reload();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao definir regime" });
    }
  }

  function requestDelete(entry: TimeOff) {
    setEntrySheet({ open: false });
    setConfirm({
      title: "Cancelar lançamento?",
      description:
        "A ausência some do calendário e dos saldos, mas fica registrada (auditável).",
      confirmLabel: "Cancelar lançamento",
      destructive: true,
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/ferias/time-off/${entry.id}`, { method: "DELETE" });
          void reload();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao cancelar" });
        }
      },
    });
  }

  return (
    <div className="space-y-3">
      {/* Header — navegação + ações */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            onClick={() => stepMonth(-1)}
            aria-label="Mês anterior"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="min-w-40 text-center text-sm font-medium capitalize">
            {monthLabel}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => stepMonth(1)}
            aria-label="Próximo mês"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setCompOpen(true)}>
            <Clock className="size-4" /> Hora extra
          </Button>
          <Button onClick={() => setEntrySheet({ open: true })}>
            <Plus className="size-4" /> Lançar
          </Button>
        </div>
      </div>

      {/* Legenda + escopo */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-teal-500/70" aria-hidden /> férias
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-amber-500/70" aria-hidden /> folga
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="size-3" aria-hidden />
          {accessLevel === "admin" ? "time inteiro" : "seu squad"}
        </span>
      </div>

      {/* Matriz */}
      {!data ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <FeriasCalendarMatrix
          year={year}
          month={month}
          members={members}
          timeOff={monthTimeOff}
          canManageContractType={data?.canManageContractType ?? false}
          onCellClick={(memberId, dateISO) =>
            setEntrySheet({ open: true, presetMemberId: memberId, presetDate: dateISO })
          }
          onEntryClick={(entry) => setEntrySheet({ open: true, entry })}
          onContractTypeChange={changeContractType}
        />
      )}

      {/* Sheets */}
      {entrySheet.open && (
        <FeriasEntrySheet
          open={entrySheet.open}
          onOpenChange={(o) => setEntrySheet((s) => ({ ...s, open: o }))}
          members={members}
          entry={entrySheet.entry}
          presetMemberId={entrySheet.presetMemberId}
          presetDate={entrySheet.presetDate}
          onSaved={reload}
          onDelete={entrySheet.entry ? requestDelete : undefined}
        />
      )}
      {compOpen && (
        <CompTimeSheet
          open={compOpen}
          onOpenChange={setCompOpen}
          members={members}
          onSaved={reload}
        />
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
