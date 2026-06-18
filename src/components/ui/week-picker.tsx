"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * WeekPicker — seletor de SEMANA (não de dia avulso).
 *
 * O campo é semanal: clicar em qualquer dia seleciona a semana inteira
 * (segunda → domingo) e o valor emitido é sempre a SEGUNDA (ISO YYYY-MM-DD).
 * No calendário, passar o mouse numa linha destaca a semana toda — deixa
 * claro que a unidade é a semana, não o dia. Resolve o "bug" de UX do
 * `<input type="date">` cru, onde escolher quinta-feira virava segunda sem
 * feedback visual.
 *
 * `value` aceita qualquer dia da semana; o componente normaliza pra segunda.
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
function parseISO(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/** Date → "YYYY-MM-DD" local (sem deslocamento de fuso). */
function toISO(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Segunda da semana de `d` (idempotente). */
function mondayOf(d: Date): Date {
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

type WeekPickerProps = {
  /** Qualquer dia da semana selecionada (ISO YYYY-MM-DD). "" = nada. */
  value: string;
  /** Recebe sempre a SEGUNDA da semana escolhida (ISO YYYY-MM-DD). */
  onChange: (mondayISO: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  // Injetados por Field.Control via cloneElement; repassados ao trigger.
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  "data-slot"?: string;
};

export function WeekPicker({
  value,
  onChange,
  disabled = false,
  placeholder = "Selecionar semana",
  className,
  ...trigger
}: WeekPickerProps) {
  const [open, setOpen] = React.useState(false);

  const selectedMonday = value ? toISO(mondayOf(parseISO(value))) : null;

  // Mês visível no calendário. Sincroniza com a semana selecionada ao abrir.
  const [view, setView] = React.useState(() => {
    const base = value ? parseISO(value) : new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });

  React.useEffect(() => {
    if (!open) return;
    const base = value ? mondayOf(parseISO(value)) : mondayOf(new Date());
    setView({ year: base.getFullYear(), month: base.getMonth() });
  }, [open, value]);

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

  function select(weekMondayISO: string) {
    onChange(weekMondayISO);
    setOpen(false);
  }

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
        <span className={cn("flex-1 truncate", !selectedMonday && "text-muted-foreground")}>
          {selectedMonday ? weekRangeLabel(selectedMonday) : placeholder}
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
            data-slot="week-picker"
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

            {/* Semanas: a LINHA inteira é o alvo (hover/selecionada destaca seg→dom) */}
            <div className="mt-1 flex flex-col gap-0.5">
              {weeks.map((week) => {
                const weekMondayISO = toISO(week[0]);
                const isSelectedWeek = weekMondayISO === selectedMonday;
                return (
                  <div
                    key={weekMondayISO}
                    className={cn(
                      "grid grid-cols-7 rounded-md transition-colors",
                      isSelectedWeek
                        ? "bg-accent"
                        : "hover:bg-accent/50",
                    )}
                  >
                    {week.map((day) => {
                      const inMonth = day.getMonth() === view.month;
                      const isToday = sameDay(day, today);
                      return (
                        <button
                          key={toISO(day)}
                          type="button"
                          onClick={() => select(weekMondayISO)}
                          className={cn(
                            "mx-auto flex size-9 items-center justify-center rounded-md text-sm tabular-nums transition-colors",
                            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                            !isSelectedWeek && "hover:text-accent-foreground",
                            isSelectedWeek
                              ? "font-medium text-accent-foreground"
                              : inMonth
                                ? "text-foreground"
                                : "text-muted-foreground/40",
                            isToday &&
                              !isSelectedWeek &&
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

            {/* Rodapé: atalho pra semana atual */}
            <div className="mt-2 flex items-center justify-between border-t pt-2">
              <span className="text-[11px] text-muted-foreground">
                A semana inteira (seg → dom) é considerada.
              </span>
              <button
                type="button"
                onClick={() => select(toISO(mondayOf(new Date())))}
                className="rounded-md px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                Esta semana
              </button>
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
