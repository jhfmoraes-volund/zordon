/**
 * PMReview — status machine enxuta (transições sem volta).
 *
 * Diferente de PlanningCeremony (que tem 6 fases ligadas a propor→aprovar),
 * PM Review é "report sempre consultável": draft é construção, published é
 * disponibilizado (mas ainda editável). Não se arquiva mais — PM Review se
 * exclui (hard delete: DELETE /api/pm-review/[id], qualquer status).
 *
 * `archived` permanece no enum como estado LEGADO: linhas antigas no banco ainda
 * carregam esse status e precisam renderizar/listar. Não há mais transição p/ ele.
 *
 * Sem trigger SQL (volume trivial). Validação só aqui + na API.
 */

export const PM_REVIEW_STATUSES = ["draft", "published", "archived"] as const;
export type PMReviewStatus = (typeof PM_REVIEW_STATUSES)[number];

const ALLOWED: ReadonlyArray<readonly [PMReviewStatus, PMReviewStatus]> = [
  ["draft", "published"],
  // Sem rollback e sem archive. PM que quiser "começar do zero" exclui + recria.
];

export type StatusStamps = {
  publishedAt?: string;
};

export type TransitionOk = {
  ok: true;
  from: PMReviewStatus;
  to: PMReviewStatus;
  stamps: StatusStamps;
};

export type TransitionErr = {
  ok: false;
  from: PMReviewStatus;
  to: PMReviewStatus;
  reason: "invalid_transition" | "unknown_status";
  detail: string;
};

export type TransitionResult = TransitionOk | TransitionErr;

function isStatus(v: string): v is PMReviewStatus {
  return (PM_REVIEW_STATUSES as readonly string[]).includes(v);
}

export function transition(
  from: string,
  to: string,
  now: () => string = () => new Date().toISOString(),
): TransitionResult {
  if (!isStatus(from) || !isStatus(to)) {
    return {
      ok: false,
      from: from as PMReviewStatus,
      to: to as PMReviewStatus,
      reason: "unknown_status",
      detail: `status inválido: from=${from} to=${to}`,
    };
  }

  if (!ALLOWED.some(([a, b]) => a === from && b === to)) {
    return {
      ok: false,
      from,
      to,
      reason: "invalid_transition",
      detail: `transição ${from} → ${to} não permitida`,
    };
  }

  const stamps: StatusStamps = {};
  if (to === "published") stamps.publishedAt = now();

  return { ok: true, from, to, stamps };
}
