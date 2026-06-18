"use client";

import { CalendarField, type CalendarFieldProps } from "@/components/ui/calendar";

/**
 * DatePicker — seletor de DIA único via calendário popover.
 *
 * Substitui o `<input type="date">` cru: visual consistente no tema escuro,
 * navegação de mês, "hoje" e (opcional) "limpar". Emite o dia escolhido como
 * ISO YYYY-MM-DD. Wrapper fino sobre `CalendarField mode="day"`.
 */
type DatePickerProps = Omit<CalendarFieldProps, "mode">;

export function DatePicker(props: DatePickerProps) {
  return <CalendarField mode="day" {...props} />;
}
