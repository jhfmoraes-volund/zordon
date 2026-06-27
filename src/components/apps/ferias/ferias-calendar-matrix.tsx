"use client";

/**
 * Matriz membro × dia do mês. Faixas de férias (teal) e folga (amber); FDS
 * sombreado. Clicar numa faixa edita o lançamento; clicar num dia vazio cria.
 * Coluna esquerda fixa: nome, regime (PJ/CLT — admin edita) e saldos.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ContractType, FeriasMember, TimeOff } from "@/lib/ferias/types";

const CONTRACT_LABEL: Record<ContractType, string> = { pj: "PJ", clt: "CLT" };
const NONE = "__none__";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function iso(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function FeriasCalendarMatrix({
  year,
  month,
  members,
  timeOff,
  canManageContractType,
  onCellClick,
  onEntryClick,
  onContractTypeChange,
}: {
  year: number;
  month: number; // 0-11
  members: FeriasMember[];
  timeOff: TimeOff[];
  canManageContractType: boolean;
  onCellClick: (memberId: string, dateISO: string) => void;
  onEntryClick: (entry: TimeOff) => void;
  onContractTypeChange: (memberId: string, ct: ContractType | null) => void;
}) {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const isWeekend = (d: number) => {
    const dow = new Date(Date.UTC(year, month, d)).getUTCDay();
    return dow === 0 || dow === 6;
  };

  // memberId → entradas (pra lookup por dia).
  const byMember = new Map<string, TimeOff[]>();
  for (const t of timeOff) {
    const arr = byMember.get(t.memberId) ?? [];
    arr.push(t);
    byMember.set(t.memberId, arr);
  }
  const entryOn = (memberId: string, dateISO: string): TimeOff | undefined =>
    (byMember.get(memberId) ?? []).find(
      (t) => dateISO >= t.startDate && dateISO <= t.endDate,
    );

  if (members.length === 0) {
    return (
      <div className="rounded-md border px-3 py-8 text-center text-sm text-muted-foreground">
        Nenhum membro no seu escopo. {canManageContractType ? "" : "Você vê só o seu squad."}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="sticky left-0 z-10 bg-muted/30 px-2 py-1.5 text-left font-medium">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Membro
              </span>
            </th>
            {days.map((d) => (
              <th
                key={d}
                className={cn(
                  "w-6 min-w-6 px-0 py-1 text-center font-mono font-normal tabular-nums text-muted-foreground",
                  isWeekend(d) && "bg-muted/50",
                )}
              >
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className="border-b last:border-0">
              {/* coluna fixa: nome + regime + saldos */}
              <td className="sticky left-0 z-10 min-w-52 max-w-52 border-r bg-background px-2 py-1.5">
                <div className="truncate font-medium">{m.name}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                  {canManageContractType ? (
                    <Select
                      value={m.contractType ?? NONE}
                      onValueChange={(v) =>
                        onContractTypeChange(m.id, v === NONE ? null : (v as ContractType))
                      }
                    >
                      <SelectTrigger className="h-5 w-16 px-1.5 text-[10px]">
                        <SelectValue>
                          {(v: string | null) =>
                            v && v !== NONE ? CONTRACT_LABEL[v as ContractType] : "regime"
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>—</SelectItem>
                        <SelectItem value="pj">PJ</SelectItem>
                        <SelectItem value="clt">CLT</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="rounded-sm border px-1 font-mono">
                      {m.contractType ? CONTRACT_LABEL[m.contractType] : "—"}
                    </span>
                  )}
                  <span className="font-mono tabular-nums">
                    fér{" "}
                    <span className="text-foreground">
                      {m.feriasRemaining ?? "–"}
                    </span>
                    /{m.feriasAllowance ?? "–"}
                  </span>
                  <span className="font-mono tabular-nums">
                    banco{" "}
                    <span className="text-foreground">{m.folgaBankHours}h</span>
                  </span>
                </div>
              </td>

              {/* dias do mês */}
              {days.map((d) => {
                const dateISO = iso(year, month, d);
                const e = entryOn(m.id, dateISO);
                const weekend = isWeekend(d);
                return (
                  <td
                    key={d}
                    className={cn("h-7 w-6 min-w-6 border-l border-border/40 p-0", weekend && "bg-muted/40")}
                  >
                    <button
                      type="button"
                      title={
                        e
                          ? `${e.type === "ferias" ? "Férias" : "Folga"} · ${e.startDate}–${e.endDate}`
                          : `Lançar em ${dateISO}`
                      }
                      onClick={() =>
                        e ? onEntryClick(e) : onCellClick(m.id, dateISO)
                      }
                      className={cn(
                        "h-7 w-full transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                        e?.type === "ferias" && "bg-teal-500/70 hover:bg-teal-500/80",
                        e?.type === "folga" && "bg-amber-500/70 hover:bg-amber-500/80",
                      )}
                      aria-label={
                        e ? `${e.type} de ${m.name}` : `Lançar para ${m.name} em ${dateISO}`
                      }
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
