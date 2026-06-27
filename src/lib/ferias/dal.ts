/**
 * Acesso ao schema `ferias`. Usa o client com cookie de sessão — a RLS
 * (admin OU manager/PM no mesmo squad; ver migration 20260626c/d) é a barreira
 * real; as rotas /api/ferias/* também asseram manager+ (defense-in-depth). O
 * schema `ferias` não está nos tipos gerados, então o client é re-castado pra
 * `.schema("ferias")` e os resultados pros tipos hand-authored (./types).
 *
 * Requer `ferias` exposto ao PostgREST (Dashboard → API → Exposed schemas),
 * igual o finance. Sem isso, as queries retornam erro de schema.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAccessLevel, getCurrentMember } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

import { FERIAS_ALLOWANCE, feriasDays } from "./dates";
import type {
  CompTimeEntry,
  CompTimeInput,
  ContractType,
  FeriasData,
  FeriasMember,
  TimeOff,
  TimeOffInput,
} from "./types";

async function ferias() {
  const sb = await createClient();
  // Public continua tipado em `sb`; só o acesso a ferias é solto.
  const fer = (sb as unknown as SupabaseClient).schema("ferias");
  return { sb, fer };
}

async function currentMemberId(): Promise<string | null> {
  const m = await getCurrentMember();
  return m?.id ?? null;
}

// ─── Escopo de membros (linhas da matriz) ─────────────────────────────────
// admin = todo o time interno; PM (manager) = membros que dividem squad com ele.
// A RLS gateia as entradas; o conjunto de linhas precisa ser computado aqui
// (membro sem nenhuma entrada também aparece na matriz).
type ScopeMemberRow = {
  id: string;
  name: string;
  position: string | null;
  contractType: string | null;
};

async function getScopeMembers(): Promise<ScopeMemberRow[]> {
  const { sb } = await ferias();
  const level = await getAccessLevel();

  const baseSelect = () =>
    sb
      .from("Member")
      .select("id, name, position, contractType")
      .eq("isExternal", false)
      .eq("isGuest", false)
      .is("deactivatedAt", null)
      .order("name");

  if (level === "admin") {
    const { data } = await baseSelect();
    return (data ?? []) as ScopeMemberRow[];
  }

  // manager/PM: membros dos squads do próprio PM.
  const me = await currentMemberId();
  if (!me) return [];
  const { data: mySquads } = await sb
    .from("SquadMember")
    .select("squadId")
    .eq("memberId", me);
  const squadIds = [...new Set((mySquads ?? []).map((r) => r.squadId))];
  if (squadIds.length === 0) return [];

  const { data: peers } = await sb
    .from("SquadMember")
    .select("memberId")
    .in("squadId", squadIds);
  const memberIds = [...new Set((peers ?? []).map((r) => r.memberId))];
  if (memberIds.length === 0) return [];

  const { data } = await baseSelect().in("id", memberIds);
  return (data ?? []) as ScopeMemberRow[];
}

// ─── Mapeamento snake → camel ─────────────────────────────────────────────
function mapTimeOff(r: Record<string, unknown>): TimeOff {
  return {
    id: r.id as string,
    memberId: r.member_id as string,
    type: r.type as TimeOff["type"],
    startDate: r.start_date as string,
    endDate: r.end_date as string,
    hours: (r.hours as number | null) ?? null,
    note: (r.note as string | null) ?? null,
  };
}

function mapCompTime(r: Record<string, unknown>): CompTimeEntry {
  return {
    id: r.id as string,
    memberId: r.member_id as string,
    date: r.date as string,
    hoursWorked: Number(r.hours_worked),
    rate: Number(r.rate),
    creditHours: Number(r.credit_hours),
    note: (r.note as string | null) ?? null,
  };
}

function asContractType(v: string | null): ContractType | null {
  return v === "pj" || v === "clt" ? v : null;
}

// ─── Leitura agregada (GET) ───────────────────────────────────────────────
export async function getFeriasData(year: number): Promise<FeriasData> {
  const { fer } = await ferias();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const [scopeMembers, level, timeOffRes, compTimeRes] = await Promise.all([
    getScopeMembers(),
    getAccessLevel(),
    fer
      .from("time_off")
      .select("*")
      .is("canceled_at", null)
      .lte("start_date", to)
      .gte("end_date", from)
      .order("start_date"),
    fer
      .from("comp_time_entry")
      .select("*")
      .is("canceled_at", null)
      .gte("date", from)
      .lte("date", to)
      .order("date"),
  ]);

  const timeOff = ((timeOffRes.data ?? []) as Record<string, unknown>[]).map(
    mapTimeOff,
  );
  const compTime = ((compTimeRes.data ?? []) as Record<string, unknown>[]).map(
    mapCompTime,
  );

  const members: FeriasMember[] = scopeMembers.map((m) => {
    const contractType = asContractType(m.contractType);
    const mine = timeOff.filter((t) => t.memberId === m.id);
    const feriasUsed = contractType
      ? mine
          .filter((t) => t.type === "ferias")
          .reduce((sum, t) => sum + feriasDays(contractType, t.startDate, t.endDate), 0)
      : 0;
    const allowance = contractType ? FERIAS_ALLOWANCE[contractType] : null;

    const credits = compTime
      .filter((c) => c.memberId === m.id)
      .reduce((sum, c) => sum + c.creditHours, 0);
    const folgaTaken = mine
      .filter((t) => t.type === "folga")
      .reduce((sum, t) => sum + (t.hours ?? 0), 0);

    return {
      id: m.id,
      name: m.name,
      position: m.position,
      contractType,
      feriasAllowance: allowance,
      feriasUsed,
      feriasRemaining: allowance === null ? null : allowance - feriasUsed,
      folgaBankHours: credits - folgaTaken,
    };
  });

  return {
    year,
    canManageContractType: level === "admin",
    members,
    timeOff,
    compTime,
  };
}

// ─── Escrita (RLS gateia squad; erro vira 4xx na rota) ────────────────────
export async function createTimeOff(input: TimeOffInput): Promise<TimeOff> {
  const { fer } = await ferias();
  const createdBy = await currentMemberId();
  const { data, error } = await fer
    .from("time_off")
    .insert({
      member_id: input.memberId,
      type: input.type,
      start_date: input.startDate,
      end_date: input.endDate,
      hours: input.type === "folga" ? (input.hours ?? null) : null,
      note: input.note ?? null,
      created_by: createdBy,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapTimeOff(data as Record<string, unknown>);
}

export async function updateTimeOff(
  id: string,
  patch: Partial<TimeOffInput>,
): Promise<TimeOff> {
  const { fer } = await ferias();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.type !== undefined) row.type = patch.type;
  if (patch.startDate !== undefined) row.start_date = patch.startDate;
  if (patch.endDate !== undefined) row.end_date = patch.endDate;
  if (patch.hours !== undefined) row.hours = patch.hours;
  if (patch.note !== undefined) row.note = patch.note;
  const { data, error } = await fer
    .from("time_off")
    .update(row)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapTimeOff(data as Record<string, unknown>);
}

export async function cancelTimeOff(id: string): Promise<void> {
  const { fer } = await ferias();
  const canceledBy = await currentMemberId();
  const { error } = await fer
    .from("time_off")
    .update({ canceled_at: new Date().toISOString(), canceled_by: canceledBy })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function createCompTime(
  input: CompTimeInput,
): Promise<CompTimeEntry> {
  const { fer } = await ferias();
  const createdBy = await currentMemberId();
  const { data, error } = await fer
    .from("comp_time_entry")
    .insert({
      member_id: input.memberId,
      date: input.date,
      hours_worked: input.hoursWorked,
      rate: input.rate ?? 1.5,
      note: input.note ?? null,
      created_by: createdBy,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapCompTime(data as Record<string, unknown>);
}

export async function cancelCompTime(id: string): Promise<void> {
  const { fer } = await ferias();
  const canceledBy = await currentMemberId();
  const { error } = await fer
    .from("comp_time_entry")
    .update({ canceled_at: new Date().toISOString(), canceled_by: canceledBy })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Admin define o regime PJ/CLT de um membro (public.Member.contractType). */
export async function setContractType(
  memberId: string,
  contractType: ContractType | null,
): Promise<void> {
  const { sb } = await ferias();
  const { error } = await sb
    .from("Member")
    .update({ contractType })
    .eq("id", memberId);
  if (error) throw new Error(error.message);
}
