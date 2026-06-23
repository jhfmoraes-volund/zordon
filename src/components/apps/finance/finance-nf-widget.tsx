"use client";

/**
 * Widget "Notas Fiscais" (read) — tira de meses (dot 🟢 recebido / 🟠 ação /
 * ⚪ futuro) + 3 passos do mês selecionado (Condição → **NF emitida** → Recebido).
 * Lê `invoice` (operacional, Q4: NÃO toca receita). Copy: **"NF emitida", NUNCA
 * "Faturado"**. Aging: issued && !received && due < hoje = vencido. `cancelled`
 * fica FORA dos rollups. Emitir/editar abre o sheet focado (escrita).
 */

import { useState } from "react";
import { AlertTriangle, Receipt } from "lucide-react";

import { Button } from "@/components/ui/button";
import { brlFromCents } from "@/lib/format-currency";
import { fmtDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { Contract, Invoice } from "@/lib/finance/types";

const COND_LABEL: Record<string, string> = {
  pf_sheet: "Planilha de PF",
  sow: "SOW",
  none: "Sem condição",
};

function monthRange(start: string, end: string): string[] {
  const out: string[] = [];
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  let y = sy;
  let m = sm;
  // cap defensivo (24 meses) — vigências abertas não estouram a tira.
  for (let i = 0; i < 24 && (y < ey || (y === ey && m <= em)); i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
function monthShort(ym: string): string {
  return new Date(`${ym}-01T00:00:00Z`)
    .toLocaleDateString("pt-BR", { month: "short", timeZone: "UTC" })
    .replace(".", "");
}
function monthFull(ym: string): string {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

type MonthState = "ok" | "act" | "idle";
type MonthCell = {
  ym: string;
  invoices: Invoice[]; // não-canceladas deste mês
  primary: Invoice | null; // a "mais avançada" (received > issued > pending)
  amountCents: number; // Σ não-canceladas ou fee esperado
  state: MonthState;
  overdue: boolean;
};

const STATUS_RANK: Record<string, number> = { received: 3, issued: 2, pending: 1, cancelled: 0 };

export function FinanceNfWidget({
  invoices,
  contractsInScope,
  emitContractId,
  year,
  onEmit,
  onOpenInvoice,
}: {
  /** NFs já escopadas (contrato selecionado, ou todas do projeto). */
  invoices: Invoice[];
  /** Contratos no escopo (1 quando contrato selecionado; todos no Global). */
  contractsInScope: Contract[];
  /** Contrato-alvo da emissão (selecionado). null no Global → sem emitir. */
  emitContractId: string | null;
  year: number;
  onEmit: (contractId: string, month: string) => void;
  onOpenInvoice: (invoice: Invoice) => void;
}) {
  const todayMonth = new Date().toISOString().slice(0, 7);
  const todayISO = new Date().toISOString().slice(0, 10);

  // Meses a exibir: os que têm NF ∪ os meses da vigência de cada contrato no
  // escopo. Encomenda (fixed_scope) também entra — emite NF pelo período, mesmo
  // sem mensalidade fixa (o valor é definido por NF).
  const monthsSet = new Set<string>();
  for (const inv of invoices) monthsSet.add(inv.competenceMonth.slice(0, 7));
  for (const c of contractsInScope) {
    const start = c.effectiveFrom.slice(0, 7);
    const end = (c.effectiveTo ?? `${year}-12-31`).slice(0, 7);
    for (const m of monthRange(start, end)) monthsSet.add(m);
  }
  const months = [...monthsSet].sort();

  const singleSquadFee =
    contractsInScope.length === 1 && contractsInScope[0].billingType === "squad"
      ? contractsInScope[0].monthlyFeeCents
      : null;

  const cells: MonthCell[] = months.map((ym) => {
    const active = invoices.filter(
      (i) => i.competenceMonth.slice(0, 7) === ym && i.status !== "cancelled",
    );
    const primary =
      [...active].sort((a, b) => (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0))[0] ??
      null;
    const amountCents = active.length
      ? active.reduce((s, i) => s + i.amountCents, 0)
      : (singleSquadFee ?? 0);
    const received = active.some((i) => i.status === "received");
    const issued = active.some((i) => i.status === "issued");
    const overdue = active.some(
      (i) => i.status === "issued" && !i.receivedAt && i.dueAt != null && i.dueAt < todayISO,
    );
    const state: MonthState = received ? "ok" : issued || ym <= todayMonth ? "act" : "idle";
    return { ym, invoices: active, primary, amountCents, state, overdue };
  });

  // Rollups (cancelled fora): recebido / total.
  const receivedSum = invoices
    .filter((i) => i.status === "received")
    .reduce((s, i) => s + i.amountCents, 0);
  const totalSum = invoices
    .filter((i) => i.status !== "cancelled")
    .reduce((s, i) => s + i.amountCents, 0);

  const defaultYm = cells.find((c) => c.state === "act")?.ym ?? cells[cells.length - 1]?.ym ?? null;
  const [selectedYm, setSelectedYm] = useState<string | null>(defaultYm);
  const sel = cells.find((c) => c.ym === selectedYm) ?? cells[0] ?? null;

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Receipt className="size-3.5" /> Notas Fiscais
      </p>
      <div className="overflow-hidden rounded-md border">
        {/* Rollup */}
        <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Recebido / total
          </span>
          <span className="font-mono text-xs tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">{brlFromCents(receivedSum)}</span>
            <span className="text-muted-foreground"> / {brlFromCents(totalSum)}</span>
          </span>
        </div>

        {cells.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhuma NF ainda{emitContractId ? " — emita a primeira abaixo." : "."}
          </p>
        ) : (
          <>
            {/* Tira de meses */}
            <div className="flex gap-1.5 overflow-x-auto border-b px-3 py-2 no-scrollbar">
              {cells.map((c) => {
                const selected = c.ym === selectedYm;
                return (
                  <button
                    key={c.ym}
                    type="button"
                    onClick={() => setSelectedYm(c.ym)}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-xs transition-colors",
                      selected
                        ? "border-foreground/25 bg-foreground/[0.06] text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/50",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 rounded-full",
                        c.state === "ok"
                          ? "bg-emerald-500"
                          : c.state === "act"
                            ? "bg-amber-500"
                            : "bg-muted-foreground/40",
                      )}
                    />
                    {monthShort(c.ym)}
                  </button>
                );
              })}
            </div>

            {/* Detalhe do mês selecionado: Condição → NF emitida → Recebido */}
            {sel && (
              <div>
                <div className="flex items-center justify-between px-3 pt-2.5 text-sm">
                  <span className="capitalize text-muted-foreground">{monthFull(sel.ym)}</span>
                  <span className="font-mono font-medium tabular-nums">{brlFromCents(sel.amountCents)}</span>
                </div>

                <Step
                  n={1}
                  state={sel.primary ? (sel.primary.conditionMet ? "ok" : "warn") : "idle"}
                  title="Condição p/ emitir NF"
                >
                  {sel.primary ? (
                    <Chip tone={sel.primary.conditionMet ? "ok" : "warn"}>
                      {COND_LABEL[sel.primary.conditionKind ?? "none"]} ·{" "}
                      {sel.primary.conditionMet ? "ok" : "pendente"}
                    </Chip>
                  ) : (
                    <span className="text-muted-foreground">definida ao emitir</span>
                  )}
                </Step>

                <Step
                  n={2}
                  state={sel.primary && sel.primary.status !== "pending" ? "ok" : "idle"}
                  title="NF emitida"
                >
                  {sel.primary && sel.primary.status !== "pending" ? (
                    <button
                      type="button"
                      onClick={() => onOpenInvoice(sel.primary!)}
                      className="inline-flex items-center gap-2 rounded-sm hover:text-foreground"
                    >
                      NF {sel.primary.number ?? "s/nº"}
                      {sel.primary.issuedAt ? ` · ${fmtDate(sel.primary.issuedAt)}` : ""}
                      {sel.overdue && (
                        <span className="inline-flex items-center gap-1 rounded-sm border border-rose-500/40 px-1.5 py-px text-[10px] text-rose-600 dark:text-rose-400">
                          <AlertTriangle className="size-3" /> vencido
                        </span>
                      )}
                      {sel.invoices.length > 1 && (
                        <span className="text-[10px] text-muted-foreground">+{sel.invoices.length - 1}</span>
                      )}
                    </button>
                  ) : (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      não emitida
                      {emitContractId && (
                        <Button size="sm" onClick={() => onEmit(emitContractId, sel.ym)}>
                          Emitir NF
                        </Button>
                      )}
                    </span>
                  )}
                </Step>

                <Step
                  n={3}
                  state={sel.primary?.status === "received" ? "ok" : "idle"}
                  title="Recebido"
                  last
                >
                  {sel.primary?.status === "received" ? (
                    <span>
                      {brlFromCents(sel.primary.receivedNetCents ?? sel.primary.amountCents)} · na conta
                    </span>
                  ) : (
                    <span className="text-muted-foreground">aguardando pagamento</span>
                  )}
                </Step>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Step({
  n,
  state,
  title,
  last,
  children,
}: {
  n: number;
  state: "ok" | "warn" | "idle";
  title: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-start gap-2.5 px-3 py-2.5", !last && "border-b")}>
      <span
        className={cn(
          "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full font-mono text-[11px]",
          state === "ok"
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : state === "warn"
              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
              : "bg-muted text-muted-foreground",
        )}
      >
        {state === "ok" ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[13px]">{children}</div>
      </div>
    </div>
  );
}

function Chip({ tone, children }: { tone: "ok" | "warn"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-sm border px-1.5 py-0.5 text-[10px] font-medium",
        tone === "ok"
          ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
          : "border-amber-500/40 text-amber-600 dark:text-amber-400",
      )}
    >
      {children}
    </span>
  );
}
