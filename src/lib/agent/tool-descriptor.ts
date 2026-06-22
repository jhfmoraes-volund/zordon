// Sem "server-only": importado pelo tools-registry, que roda no MCP server CLI.
import type { Tool } from "ai";
import type { ToolContext } from "./tools-registry";

/**
 * ToolDescriptor — contrato declarativo de UMA tool. É a SSOT do pertencimento
 * (`surfaces`) e do escopo (`needs`): o registry deriva getToolNamesForAgent, a
 * matriz e o guard de drift disto. Ver runbook agent-capability-unification §3.1.
 *
 * O `bind` continua sendo a factory existente — os require* ficam DENTRO dele
 * (preserva as mensagens hand-tuned). `needs` é METADATA; a consistência
 * needs↔bind é garantida por TESTE (findNeedsBindMismatch), não por substituir
 * o guard de runtime.
 */
export type Surface =
  | "vitor"
  | "vitoria:pm_review"
  | "vitoria:planning"
  | "vitoria:release_planning"
  | "vitoria:wiki"
  | "alpha";

/** Doutrina §2 — ORIENT é prompt, não tool. */
export type ToolClass = "sense" | "act" | "remember";

/**
 * Campos do ToolContext que um bind HARD-GUARDA via require* (dão throw se
 * ausentes). NÃO inclui `projectId`: é `string` não-nulável (o router sempre
 * resolve), então nunca é "promovido a obrigatório" por uma tool — é invariante,
 * não need. `planningId ?? ""` em reads compartilhados também NÃO é need (é
 * açúcar interno do bind, tolerado-vazio).
 */
export type CtxNeed =
  | "sessionId"
  | "memberId"
  | "pmReviewId"
  | "planningId"
  | "releasePlanningId"
  | "routeProjectId"
  | "routeSprintId"
  | "workspacePath"
  | "projectId"; // só aparece DENTRO de um OR-group (ex.: wiki: [["routeProjectId","projectId"]])

/** Array interno = grupo OR (basta UM presente). Ex.: requireWikiProjectId
 *  = routeProjectId || projectId → needs: [["routeProjectId", "projectId"]]. */
export type NeedGroup = CtxNeed | CtxNeed[];

export type ToolDescriptor = {
  /** Nome canônico (chave do registry / mcp__zordon__<name>) — SSOT. */
  name: string;
  /** ÚNICA fonte do pertencimento. Compartilhar = adicionar 1 surface. */
  surfaces: Surface[];
  class: ToolClass;
  /** O que o bind hard-guarda (metadata; consistência provada por teste). */
  needs: NeedGroup[];
  /** Lido se presente (ex.: scope-objeto do read_context_source). */
  optional?: CtxNeed[];
  /** Uma linha pra matriz gerada (ACU-005). Opcional por ora. */
  summary?: string;
  /** A factory existente — require* fica AQUI DENTRO. */
  bind: (ctx: ToolContext) => Tool;
};

/** Presença no sentido dos require* do registry: `!ctx.x` = ausente. */
function present(ctx: ToolContext, key: CtxNeed): boolean {
  const v = (ctx as Record<string, unknown>)[key];
  return v != null && v !== "";
}

/** Um grupo é satisfeito se QUALQUER chave dele está presente (OR). */
export function needGroupSatisfied(group: NeedGroup, ctx: ToolContext): boolean {
  const keys = Array.isArray(group) ? group : [group];
  return keys.some((k) => present(ctx, k));
}

/** Grupos de needs não satisfeitos por um ctx (pra mensagens/diagnóstico). */
export function missingNeeds(
  needs: NeedGroup[],
  ctx: ToolContext,
): NeedGroup[] {
  return needs.filter((g) => !needGroupSatisfied(g, ctx));
}

/**
 * Consistência needs↔bind: pra cada need-group declarado, zera as chaves do
 * grupo num ctx completo e exige que o bind DÊ THROW. Se não der, o `needs`
 * mente sobre o que o bind realmente exige. Usado pelo bind-smoke (ACU-003).
 */
export function findNeedsBindMismatch(
  d: ToolDescriptor,
  fullCtx: ToolContext,
): string[] {
  const problems: string[] = [];
  for (const group of d.needs) {
    const keys = Array.isArray(group) ? group : [group];
    const ctx = { ...fullCtx } as Record<string, unknown>;
    for (const k of keys) ctx[k] = null;
    let threw = false;
    try {
      d.bind(ctx as ToolContext);
    } catch {
      threw = true;
    }
    if (!threw) {
      problems.push(
        `${d.name}: needs ${JSON.stringify(group)} declarado, mas bind não deu throw quando ausente`,
      );
    }
  }
  return problems;
}
