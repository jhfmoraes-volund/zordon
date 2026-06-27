/**
 * Tipos do app Férias & Folgas. O schema `ferias` não está nos tipos gerados
 * (padrão finance — ver src/lib/ferias/dal.ts), então os DTOs são hand-authored
 * aqui, em camelCase; o DAL mapeia das colunas snake_case do Postgres.
 */

export type ContractType = "pj" | "clt";
export type TimeOffType = "ferias" | "folga";

/** Ausência no calendário (férias ou folga tirada). */
export type TimeOff = {
  id: string;
  memberId: string;
  type: TimeOffType;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  hours: number | null; // folga: horas debitadas do banco
  note: string | null;
};

/** Crédito de hora extra no banco de horas (folga). */
export type CompTimeEntry = {
  id: string;
  memberId: string;
  date: string; // YYYY-MM-DD
  hoursWorked: number;
  rate: number;
  creditHours: number; // hoursWorked * rate
  note: string | null;
};

/** Membro no escopo do app, com saldos já calculados pro ano. */
export type FeriasMember = {
  id: string;
  name: string;
  position: string | null;
  contractType: ContractType | null;
  feriasAllowance: number | null; // 10 (pj) | 30 (clt) | null (regime indefinido)
  feriasUsed: number; // dias usados no ano (úteis se pj, corridos se clt)
  feriasRemaining: number | null;
  folgaBankHours: number; // saldo do banco de horas (créditos − folgas)
};

export type FeriasData = {
  year: number;
  /** Admin pode definir o regime PJ/CLT dos membros. */
  canManageContractType: boolean;
  members: FeriasMember[];
  timeOff: TimeOff[];
  compTime: CompTimeEntry[];
};

export type TimeOffInput = {
  memberId: string;
  type: TimeOffType;
  startDate: string;
  endDate: string;
  hours?: number | null;
  note?: string | null;
};

export type CompTimeInput = {
  memberId: string;
  date: string;
  hoursWorked: number;
  rate?: number;
  note?: string | null;
};
