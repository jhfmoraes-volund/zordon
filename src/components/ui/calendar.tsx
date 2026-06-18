"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * CalendarField — motor compartilhado de seleção de data via popover.
 *
 * Dois modos (parity por prop, não por cópia):
 *  - `mode="day"`  → seleciona um dia; emite esse dia (ISO YYYY-MM-DD).
 *  - `mode="week"` → seleciona a SEMANA; emite sempre a SEGUNDA. No grid, a
 *    linha inteira (seg→dom) é o alvo de hover/seleção.
 *
 * Substitui o `<input type="date">` cru (picker nativo do SO, inconsistente no
 * tema escuro). Consumido pelos wrappers `DatePicker` e `WeekPicker`.
 */

const MONTHS_SHORT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];
const MONTHS_LONG = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const WEEKDAYS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

/** Parse local-safe de "YYYY-MM-DD" → Date à meia-noite local. */
export function parseISO(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/** Date → "YYYY-MM-DD" local (sem deslocamento de fuso). */
export function toISO(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Segunda da semana de `d` (idempotente). */
export function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = out.getDay(); // 0=dom … 6=sáb
  const diff = dow === 0 ? -6 : 1 - dow;
  out.setDate(out.getDate() + diff);
  return out;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "18 de jun de 2026" */
function dayLabel(iso: string): string {
  const d = parseISO(iso);
  return `${d.getDate()} de ${MONTHS_SHORT[d.getMonth()]} de ${d.getFullYear()}`;
}

/** "15 – 21 de jun de 2026", cross-mês e cross-ano resolvidos. */
function weekRangeLabel(mondayISO: string): string {
  const mon = mondayOf(parseISO(mondayISO));
  const sun = addDays(mon, 6);
  const d1 = mon.getDate();
  const d2 = sun.getDate();
  const m1 = mon.getMonth();
  const m2 = sun.getMonth();
  const y1 = mon.getFullYear();
  const y2 = sun.getFullYear();
  if (y1 !== y2) {
    return `${d1} ${MONTHS_SHORT[m1]} ${y1} – ${d2} ${MONTHS_SHORT[m2]} ${y2}`;
  }
  if (m1 !== m2) {
    return `${d1} ${MONTHS_SHORT[m1]} – ${d2} ${MONTHS_SHORT[m2]} de ${y1}`;
  }
  return `${d1} – ${d2} de ${MONTHS_SHORT[m1]} de ${y1}`;
}

/** 6 semanas (42 dias) ancoradas na segunda da 1ª semana do mês. */
function buildWeeks(year: number, month: number): Date[][] {
  const start = mondayOf(new Date(year, month, 1));
  const weeks: Date[][] = [];
  let cursor = start;
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export type CalendarFieldProps = {
  mode: "day" | "week";
  /** ISO YYYY-MM-DD. No modo week, qualquer dia da semana; "" = nada. */
  value: string;
  /** day → o dia; week → a SEGUNDA da semana. */
  onChange: (iso: string) => void;
  disabled?: boolean;
  /** Mostra "Limpar" no rodapé (campos opcionais). */
  clearable?: boolean;
  /** Limites de seleção (ISO). Dias fora ficam desabilitados. */
  min?: string;
  max?: string;
  placeholder?: string;
  className?: string;
  // Injetados por Field.Control via cloneElement; repassados ao trigger.
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  "data-slot"?: string;
};

export function CalendarField({
  mode,
  value,
  onChange,
  disabled = false,
  clearable = false,
  min,
  max,
  placeholder,
  className,
  ...trigger
}: CalendarFieldProps) {
  const [open, setOpen] = React.useState(false);
  const isWeek = mode === "week";

  // Chave de seleção: dia exato (day) ou segunda da semana (week).
  const selectedKey = value
    ? isWeek
      ? toISO(mondayOf(parseISO(value)))
      : toISO(parseISO(value))
    : null;

  const [view, setView] = React.useState(() => {
    const base = value ? parseISO(value) : new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });

  React.useEffect(() => {
    if (!open) return;
    const base = value ? parseISO(value) : new Date();
    const anchor = isWeek ? mondayOf(base) : base;
    setView({ year: anchor.getFullYear(), month: anchor.getMonth() });
  }, [open, value, isWeek]);

  const weeks = React.useMemo(
    () => buildWeeks(view.year, view.month),
    [view.year, view.month],
  );
  const today = new Date();

  function shiftMonth(delta: number) {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  function outOfRange(day: Date): boolean {
    const iso = toISO(day);
    if (min && iso < min) return true;
    if (max && iso > max) return true;
    return false;
  }

  function select(day: Date) {
    onChange(isWeek ? toISO(mondayOf(day)) : toISO(day));
    setOpen(false);
  }

  const triggerLabel = value
    ? isWeek
      ? weekRangeLabel(value)
      : dayLabel(value)
    : (placeholder ?? (isWeek ? "Selecionar semana" : "Selecionar data"));

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        {...trigger}
        disabled={disabled}
        className={cn(
          "flex h-[var(--field-h)] w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-1 text-left text-sm shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "data-popup-open:ring-1 data-popup-open:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
        <span className={cn("flex-1 truncate", !value && "text-muted-foreground")}>
          {triggerLabel}
        </span>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          className="isolate z-50 outline-none"
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <PopoverPrimitive.Popup
            data-slot="calendar"
            className={cn(
              "z-50 w-[18rem] origin-(--transform-origin) rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none",
              "duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            )}
          >
            {/* Header: mês + navegação */}
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                aria-label="Mês anterior"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <ChevronLeft className="size-4" />
              </button>
              <div className="text-sm font-medium tabular-nums">
                {MONTHS_LONG[view.month]} de {view.year}
              </div>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                aria-label="Próximo mês"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            {/* Cabeçalho dos dias da semana */}
            <div className="grid grid-cols-7 gap-px">
              {WEEKDAYS.map((wd) => (
                <div
                  key={wd}
                  className="flex h-7 items-center justify-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {wd}
                </div>
              ))}
            </div>

            {/* Grid de dias */}
            <div className="mt-1 flex flex-col gap-0.5">
              {weeks.map((week) => {
                const weekKey = toISO(week[0]);
                // No modo week a LINHA inteira destaca; no modo day, cada célula.
                const rowSelected = isWeek && weekKey === selectedKey;
                return (
                  <div
                    key={weekKey}
                    className={cn(
                      "grid grid-cols-7 rounded-md transition-colors",
                      isWeek &&
                        (rowSelected ? "bg-accent" : "hover:bg-accent/50"),
                    )}
                  >
                    {week.map((day) => {
                      const iso = toISO(day);
                      const inMonth = day.getMonth() === view.month;
                      const isToday = sameDay(day, today);
                      const daySelected = isWeek
                        ? rowSelected
                        : iso === selectedKey;
                      const disabledDay = outOfRange(day);
                      return (
                        <button
                          key={iso}
                          type="button"
                          disabled={disabledDay}
                          onClick={() => select(day)}
                          className={cn(
                            "mx-auto flex size-9 items-center justify-center rounded-md text-sm tabular-nums transition-colors",
                            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                            "disabled:pointer-events-none disabled:opacity-30",
                            // Hover por célula só no modo day (no week a linha já trata).
                            !isWeek && !daySelected && "hover:bg-accent hover:text-accent-foreground",
                            isWeek && !daySelected && "hover:text-accent-foreground",
                            daySelected
                              ? isWeek
                                ? "font-medium text-accent-foreground"
                                : "bg-primary font-medium text-primary-foreground"
                              : inMonth
                                ? "text-foreground"
                                : "text-muted-foreground/40",
                            isToday &&
                              !daySelected &&
                              "font-semibold ring-1 ring-inset ring-border",
                          )}
                        >
                          {day.getDate()}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Rodapé */}
            <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
              {clearable && value ? (
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                  className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  Limpar
                </button>
              ) : isWeek ? (
                <span className="text-[11px] text-muted-foreground">
                  A semana inteira (seg → dom).
                </span>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => select(new Date())}
                className="rounded-md px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {isWeek ? "Esta semana" : "Hoje"}
              </button>
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
