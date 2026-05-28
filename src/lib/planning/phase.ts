/**
 * PlanningCeremony — máquina de estados das fases.
 *
 * Camadas (aprendizado Meeting: regra de acesso vive em TS + SQL):
 *   • Aqui (TS): validação RICA — transições + pré-condições + side effects.
 *   • Trigger SQL (migration 20260528d): cinto de segurança contra escrita
 *     direta via service_role/seed. Espelha SÓ a matriz de transições.
 *     Se divergir desta lib, é bug — alinhar antes de mergear.
 *
 * Side effects (stamps de timestamp) são DESCRITOS aqui pra a API aplicar
 * no UPDATE; esta lib não toca banco. Mantém testável sem mock.
 */

export const PLANNING_PHASES = [
  "idle",
  "reading",
  "proposing",
  "approving",
  "closed",
  "archived",
] as const;

export type PlanningPhase = (typeof PLANNING_PHASES)[number];

/**
 * Matriz de transições permitidas. Espelha o trigger SQL em
 * `validate_planning_phase_transition()`. NÃO divergir.
 */
const ALLOWED_TRANSITIONS: ReadonlyArray<readonly [PlanningPhase, PlanningPhase]> = [
  ["idle", "reading"],
  ["reading", "proposing"],
  ["reading", "idle"], // reset briefing
  ["proposing", "approving"],
  ["proposing", "idle"], // reset briefing
  ["approving", "closed"],
  ["closed", "archived"],
];

/**
 * Contexto da cerimônia que a state machine precisa pra avaliar
 * pré-condições. Carregado pela API/DAL antes de chamar `transition()`.
 *
 * Mantém leve: só contagens, não objetos. A camada de DAL traduz queries
 * em counts; aqui é lógica pura.
 */
export type PhaseContext = {
  linkedMeetingCount: number;
  linkedTranscriptCount: number;
  contextNoteCount: number;
  summaryNoteCount: number; // notes com kind='summary'
  pendingActionCount: number; // MeetingTaskAction com decision='pending'
};

/**
 * Quem dispara a transição. Algumas transições só fazem sentido vindas
 * de um lado específico (ex: `reading → proposing` é o Alpha terminando
 * a ingestão; `proposing → approving` é o PM clicando).
 */
export type Actor = "pm" | "alpha";

/**
 * Side effects que a API deve aplicar no UPDATE (timestamps a stampar).
 * O caller faz o UPDATE com `{ phase: to, ...stamps }`.
 */
export type PhaseStamps = {
  startedAt?: string;
  briefingGeneratedAt?: string;
  closedAt?: string;
  archivedAt?: string;
};

export type TransitionOk = {
  ok: true;
  from: PlanningPhase;
  to: PlanningPhase;
  stamps: PhaseStamps;
};

export type TransitionErr = {
  ok: false;
  from: PlanningPhase;
  to: PlanningPhase;
  reason:
    | "invalid_transition"
    | "missing_preconditions"
    | "wrong_actor"
    | "unknown_phase";
  detail: string;
};

export type TransitionResult = TransitionOk | TransitionErr;

function isPhase(v: string): v is PlanningPhase {
  return (PLANNING_PHASES as readonly string[]).includes(v);
}

function transitionAllowed(from: PlanningPhase, to: PlanningPhase): boolean {
  return ALLOWED_TRANSITIONS.some(([a, b]) => a === from && b === to);
}

/**
 * Tenta transicionar `from → to`. Retorna o resultado com stamps a aplicar,
 * OU um erro tipado explicando o motivo.
 *
 * Não muta nada — é função pura. A API/DAL aplica o resultado no banco.
 */
export function transition(
  from: string,
  to: string,
  ctx: PhaseContext,
  actor: Actor,
  now: () => string = () => new Date().toISOString(),
): TransitionResult {
  if (!isPhase(from) || !isPhase(to)) {
    return {
      ok: false,
      from: from as PlanningPhase,
      to: to as PlanningPhase,
      reason: "unknown_phase",
      detail: `phase inválida: from=${from} to=${to}`,
    };
  }

  if (!transitionAllowed(from, to)) {
    return {
      ok: false,
      from,
      to,
      reason: "invalid_transition",
      detail: `transição ${from} → ${to} não está na matriz`,
    };
  }

  // Pré-condições por transição.
  const stamps: PhaseStamps = {};

  switch (`${from}->${to}`) {
    case "idle->reading": {
      // PM começa o briefing — precisa de ≥1 insumo linkado.
      if (actor !== "pm") {
        return {
          ok: false,
          from,
          to,
          reason: "wrong_actor",
          detail: "só PM dispara idle → reading",
        };
      }
      if (ctx.linkedMeetingCount === 0 && ctx.linkedTranscriptCount === 0) {
        return {
          ok: false,
          from,
          to,
          reason: "missing_preconditions",
          detail: "linke ≥1 reunião ou transcript antes de começar o briefing",
        };
      }
      stamps.startedAt = now();
      break;
    }

    case "reading->proposing": {
      // Alpha emite "briefing pronto" — exige ≥1 summary + ≥3 outras notes.
      if (actor !== "alpha") {
        return {
          ok: false,
          from,
          to,
          reason: "wrong_actor",
          detail: "só Alpha dispara reading → proposing",
        };
      }
      if (ctx.summaryNoteCount < 1) {
        return {
          ok: false,
          from,
          to,
          reason: "missing_preconditions",
          detail: "briefing precisa de ≥1 note de kind='summary'",
        };
      }
      const otherNotes = ctx.contextNoteCount - ctx.summaryNoteCount;
      if (otherNotes < 3) {
        return {
          ok: false,
          from,
          to,
          reason: "missing_preconditions",
          detail: `briefing precisa de ≥3 notes além do summary (tem ${otherNotes})`,
        };
      }
      stamps.briefingGeneratedAt = now();
      break;
    }

    case "proposing->approving": {
      // PM clica "revisar" — exige ≥1 action pendente pra revisar.
      if (actor !== "pm") {
        return {
          ok: false,
          from,
          to,
          reason: "wrong_actor",
          detail: "só PM dispara proposing → approving",
        };
      }
      if (ctx.pendingActionCount < 1) {
        return {
          ok: false,
          from,
          to,
          reason: "missing_preconditions",
          detail: "nenhuma proposta pendente pra revisar",
        };
      }
      break;
    }

    case "approving->closed": {
      // PM aprovou/dispensou todas — exige 0 pendentes.
      if (actor !== "pm") {
        return {
          ok: false,
          from,
          to,
          reason: "wrong_actor",
          detail: "só PM dispara approving → closed",
        };
      }
      if (ctx.pendingActionCount > 0) {
        return {
          ok: false,
          from,
          to,
          reason: "missing_preconditions",
          detail: `ainda há ${ctx.pendingActionCount} proposta(s) pendente(s)`,
        };
      }
      stamps.closedAt = now();
      break;
    }

    case "closed->archived": {
      // PM manual OU cron 30d — sem pré-condição rica.
      stamps.archivedAt = now();
      break;
    }

    case "reading->idle":
    case "proposing->idle": {
      // Reset do briefing. Side effect (DELETE PlanningContextNote) é do caller.
      if (actor !== "pm") {
        return {
          ok: false,
          from,
          to,
          reason: "wrong_actor",
          detail: "só PM reseta briefing",
        };
      }
      break;
    }

    default:
      // Defensivo — não deveria acontecer porque transitionAllowed já filtrou.
      return {
        ok: false,
        from,
        to,
        reason: "invalid_transition",
        detail: `transição ${from} → ${to} não tratada`,
      };
  }

  return { ok: true, from, to, stamps };
}

/**
 * Lista as transições alcançáveis a partir de uma fase (pra UI montar
 * botões disponíveis sem hardcoded). Não checa pré-condições — só matriz.
 */
export function nextPhases(from: PlanningPhase): PlanningPhase[] {
  return ALLOWED_TRANSITIONS.filter(([a]) => a === from).map(([, b]) => b);
}
