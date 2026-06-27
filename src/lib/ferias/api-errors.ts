/**
 * Mapeia erro de escrita no schema `ferias` pra status HTTP. Negação da RLS
 * (PM tentando mexer fora do squad) → 403; demais erros de constraint/input → 400.
 */
export function feriasWriteStatus(message: string): number {
  return /row-level security|insufficient_privilege|violates row-level/i.test(
    message,
  )
    ? 403
    : 400;
}

export function feriasWriteMessage(message: string, status: number): string {
  return status === 403
    ? "Sem permissão para este membro — fora do seu squad."
    : message;
}
