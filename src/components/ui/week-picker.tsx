"use client";

import { CalendarField, type CalendarFieldProps } from "@/components/ui/calendar";

/**
 * WeekPicker — seletor de SEMANA (não de dia avulso).
 *
 * Clicar em qualquer dia seleciona a semana inteira (segunda → domingo); o
 * valor emitido é sempre a SEGUNDA (ISO YYYY-MM-DD). No calendário, a linha
 * inteira destaca ao passar o mouse — deixa claro que a unidade é a semana.
 * Wrapper fino sobre `CalendarField mode="week"`.
 */
type WeekPickerProps = Omit<CalendarFieldProps, "mode">;

export function WeekPicker(props: WeekPickerProps) {
  return <CalendarField mode="week" {...props} />;
}
