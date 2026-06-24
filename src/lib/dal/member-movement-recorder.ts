import "server-only";
import { getActorMemberId } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Allocation } from "@/lib/finance/types";

/**
 * Recorder de MemberMovementEvent (MAH-008) — espelha task-activity-recorder.
 *
 * Emite eventos append-only pra cada mutação de alocação + desativação de membro.
 * Tabela append-only (RLS: READ public.Member, WRITE service_role). Best-effort:
 * falhas logam + continuam (não derrubam a operação primária).
 *
 * Event kinds (vocabulary canônica):
 *   - allocation_created
 *   - allocation_voided
 *   - allocation_restored
 *   - allocation_closed
 *   - allocation_purged (hard delete, MAH-009)
 *   - member_deactivated
 */

export type MemberMovementEventKind =
  | "allocation_created"
  | "allocation_voided"
  | "allocation_restored"
  | "allocation_closed"
  | "allocation_purged"
  | "member_deactivated";

type EventInput = {
  kind: MemberMovementEventKind;
  memberId: string | null;
  projectId: string | null;
  contractId: string | null;
  allocationId?: string | null;
  payload: Record<string, unknown>;
};

/**
 * Emite 1 MemberMovementEvent via service_role (bypassa RLS append-only).
 * Best-effort — catch + log, nunca joga exceção.
 */
async function emit(
  event: EventInput,
  actorMemberId: string | null,
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("MemberMovementEvent").insert({
      kind: event.kind,
      memberId: event.memberId,
      projectId: event.projectId,
      contractId: event.contractId,
      allocationId: event.allocationId ?? null,
      payload: event.payload as unknown as Record<string, never>,
      actorMemberId,
    });
    if (error) {
      console.error("[member-movement] emit failed", { kind: event.kind, error });
    }
  } catch (e) {
    console.error("[member-movement] emit threw", { kind: event.kind, error: e });
  }
}

/**
 * Allocation criada (INSERT na labor_allocation). Payload: snapshot do allocation.
 */
export async function recordAllocationCreated(
  allocation: Allocation,
): Promise<void> {
  const actor = await getActorMemberId().catch(() => null);
  await emit(
    {
      kind: "allocation_created",
      memberId: allocation.member_id,
      projectId: allocation.project_id,
      contractId: allocation.contract_id ?? null,
      allocationId: allocation.id,
      payload: {
        percent: allocation.percent,
        days: allocation.days,
        kind: allocation.kind,
        effectiveFrom: allocation.effective_from,
        effectiveTo: allocation.effective_to,
        note: allocation.note,
      },
    },
    actor,
  );
}

/**
 * Allocation marcada como erro (void). Payload: {reason, ...}.
 */
export async function recordAllocationVoided(
  allocationBefore: Allocation,
  allocationAfter: Allocation,
): Promise<void> {
  const actor = await getActorMemberId().catch(() => null);
  await emit(
    {
      kind: "allocation_voided",
      memberId: allocationAfter.member_id,
      projectId: allocationAfter.project_id,
      contractId: allocationAfter.contract_id ?? null,
      allocationId: allocationAfter.id,
      payload: {
        reason: allocationAfter.voided_reason,
        voidedAt: allocationAfter.voided_at,
        before: {
          percent: allocationBefore.percent,
          effectiveFrom: allocationBefore.effective_from,
          effectiveTo: allocationBefore.effective_to,
        },
      },
    },
    actor,
  );
}

/**
 * Allocation restaurada (limpa void_*). Payload: snapshot.
 */
export async function recordAllocationRestored(
  allocation: Allocation,
): Promise<void> {
  const actor = await getActorMemberId().catch(() => null);
  await emit(
    {
      kind: "allocation_restored",
      memberId: allocation.member_id,
      projectId: allocation.project_id,
      contractId: allocation.contract_id ?? null,
      allocationId: allocation.id,
      payload: {
        percent: allocation.percent,
        effectiveFrom: allocation.effective_from,
        effectiveTo: allocation.effective_to,
      },
    },
    actor,
  );
}

/**
 * Allocation fechada (seta effective_to + closed_by). Payload: {before, after}.
 */
export async function recordAllocationClosed(
  allocationBefore: Allocation,
  allocationAfter: Allocation,
): Promise<void> {
  const actor = await getActorMemberId().catch(() => null);
  await emit(
    {
      kind: "allocation_closed",
      memberId: allocationAfter.member_id,
      projectId: allocationAfter.project_id,
      contractId: allocationAfter.contract_id ?? null,
      allocationId: allocationAfter.id,
      payload: {
        before: {
          effectiveTo: allocationBefore.effective_to,
        },
        after: {
          effectiveTo: allocationAfter.effective_to,
          closedBy: allocationAfter.closed_by,
        },
      },
    },
    actor,
  );
}

/**
 * Allocation purgada (hard DELETE — MAH-009). Emite ANTES de apagar a row, pra que
 * o evento persista mesmo sem a alocação. Payload: snapshot completo da linha.
 */
export async function recordAllocationPurged(
  allocation: Allocation,
): Promise<void> {
  const actor = await getActorMemberId().catch(() => null);
  await emit(
    {
      kind: "allocation_purged",
      memberId: allocation.member_id,
      projectId: allocation.project_id,
      contractId: allocation.contract_id ?? null,
      allocationId: allocation.id,
      payload: {
        // Snapshot completo da linha ANTES do DELETE — histórico preservado no evento.
        percent: allocation.percent,
        days: allocation.days,
        kind: allocation.kind,
        effectiveFrom: allocation.effective_from,
        effectiveTo: allocation.effective_to,
        note: allocation.note,
        voidedAt: allocation.voided_at,
        voidedReason: allocation.voided_reason,
        voidedBy: allocation.voided_by,
        closedBy: allocation.closed_by,
      },
    },
    actor,
  );
}

/**
 * Membro desativado (D7: fecha alocações abertas + bane login). Payload: {reason}.
 * Recebe lista de allocationIds fechadas em batch (desativar fecha N alocações
 * de uma vez; registrar em 1 evento é mais econômico que N eventos "closed").
 */
export async function recordMemberDeactivated(
  memberId: string,
  reason: string,
  closedAllocationIds: string[],
): Promise<void> {
  const actor = await getActorMemberId().catch(() => null);
  await emit(
    {
      kind: "member_deactivated",
      memberId,
      projectId: null,
      contractId: null,
      payload: {
        reason,
        closedAllocationIds,
        closedCount: closedAllocationIds.length,
      },
    },
    actor,
  );
}
