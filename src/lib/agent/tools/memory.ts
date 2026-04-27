/**
 * Memory tools — Vitor's structured memory layer.
 *
 * Plan: docs/vitor-memory-plan.md
 *
 * Convention:
 *   - Factory pattern: each tool is a function that closes over sessionId/projectId.
 *   - All writes happen via service-role (db()), bypassing RLS.
 *   - Tools never accept sessionId/projectId in input — closure prevents the LLM
 *     from writing to the wrong scope.
 */

import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";

const confidenceEnum = z.enum(["hard_fact", "inferred", "assumption"]);
const decisionStatusEnum = z.enum(["active", "under_review", "reverted"]);
const openQuestionStatusEnum = z.enum(["open", "answered", "obsolete"]);

// ─── Decisions ──────────────────────────────────────────────

export function createRecordDecisionTool(sessionId: string, projectId: string) {
  return tool({
    description:
      "Registra uma decisão estruturada. Use quando o usuário disser 'vamos focar em X', 'X fora', 'Y é prioridade', ou quando confirma uma restrição. SEMPRE liste decisions antes (list_decisions) pra evitar duplicatas — se uma decisão semanticamente equivalente já existe, NÃO chame esta tool.",
    inputSchema: z.object({
      statement: z.string().describe("A decisão em uma frase (ex: 'iOS fora do MVP')"),
      rationale: z.string().describe("Por quê — uma frase explicando a razão"),
      confidence: confidenceEnum.describe(
        "hard_fact = usuário disse explicitamente; inferred = derivado de research/contexto; assumption = palpite seu",
      ),
      tags: z
        .array(z.string())
        .optional()
        .describe("Tags como 'scope', 'platform', 'compliance', 'budget'"),
    }),
    execute: async ({ statement, rationale, confidence, tags }) => {
      const { data, error } = await db()
        .from("DesignDecision")
        .insert({
          sessionId,
          projectId,
          statement,
          rationale,
          confidence,
          tags: tags ?? null,
          createdBy: "vitor",
        })
        .select("id, statement, status, confidence, tags, createdAt")
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, decision: data };
    },
  });
}

export function createReviseDecisionTool(sessionId: string, projectId: string) {
  return tool({
    description:
      "Revisa uma decisão existente. Use quando o usuário contradiz uma decisão ativa: marca como 'under_review' imediatamente (NÃO espere confirmação), e só passa pra 'reverted' depois que o usuário confirmar a mudança. Se for 'reverted' E houver substituta, registra a nova com record_decision e passa o id em supersededByNew.",
    inputSchema: z.object({
      id: z.string().describe("ID da decisão a revisar"),
      newStatus: decisionStatusEnum,
      supersededByNew: z
        .string()
        .optional()
        .describe("Se reverted, id da nova decisão que substitui esta"),
    }),
    execute: async ({ id, newStatus, supersededByNew }) => {
      const { data: existing, error: fetchErr } = await db()
        .from("DesignDecision")
        .select("id, status, sessionId, projectId")
        .eq("id", id)
        .maybeSingle();
      if (fetchErr || !existing) {
        return { ok: false, error: `decision ${id} not found` };
      }
      if (existing.projectId !== projectId) {
        return { ok: false, error: "decision belongs to another project" };
      }

      const { error } = await db()
        .from("DesignDecision")
        .update({
          status: newStatus,
          supersededBy: supersededByNew ?? null,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) return { ok: false, error: error.message };
      return { ok: true, oldStatus: existing.status, newStatus };
    },
  });
}

export function createListDecisionsTool(sessionId: string, projectId: string) {
  return tool({
    description:
      "Lista decisões do projeto ou da session. SEMPRE chame antes de propor algo que toca scope, plataforma, compliance — pra detectar contradição. Filtros opcionais: scope (project|session), status, tags.",
    inputSchema: z.object({
      scope: z.enum(["project", "session"]).default("project"),
      status: decisionStatusEnum.optional(),
      tags: z.array(z.string()).optional(),
    }),
    execute: async ({ scope, status, tags }) => {
      let q = db()
        .from("DesignDecision")
        .select("id, statement, rationale, confidence, status, tags, createdAt, supersededBy")
        .order("createdAt", { ascending: false });
      if (scope === "session") q = q.eq("sessionId", sessionId);
      else q = q.eq("projectId", projectId);
      if (status) q = q.eq("status", status);
      if (tags?.length) q = q.overlaps("tags", tags);
      const { data, error } = await q;
      if (error) return { ok: false, error: error.message };
      return { ok: true, decisions: data ?? [] };
    },
  });
}

// ─── Open Questions ─────────────────────────────────────────

export function createAddOpenQuestionTool(sessionId: string, projectId: string) {
  return tool({
    description:
      "Registra uma pergunta aberta — algo que você NÃO sabe ainda mas precisa pra avançar. Use SEMPRE que for chutar ('vou assumir X por enquanto'). Se a sugestão depende dessa info, marque com confidence=assumption.",
    inputSchema: z.object({
      question: z.string().describe("A pergunta em si"),
      blocksWhat: z
        .string()
        .optional()
        .describe("O que essa pergunta bloqueia (ex: 'definição de stack', 'priorização do checkout')"),
    }),
    execute: async ({ question, blocksWhat }) => {
      const { data, error } = await db()
        .from("DesignOpenQuestion")
        .insert({
          sessionId,
          projectId,
          question,
          blocksWhat: blocksWhat ?? null,
        })
        .select("id, question, blocksWhat, status, createdAt")
        .single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, openQuestion: data };
    },
  });
}

export function createResolveOpenQuestionTool(sessionId: string, projectId: string) {
  return tool({
    description:
      "Marca uma pergunta aberta como resolvida quando o usuário responde, ou como obsoleta se não interessa mais.",
    inputSchema: z.object({
      id: z.string(),
      status: z.enum(["answered", "obsolete"]).default("answered"),
      answer: z.string().optional().describe("Resposta dada pelo usuário (se status=answered)"),
    }),
    execute: async ({ id, status, answer }) => {
      const { error } = await db()
        .from("DesignOpenQuestion")
        .update({
          status,
          answer: answer ?? null,
          answeredAt: status === "answered" ? new Date().toISOString() : null,
        })
        .eq("id", id)
        .eq("projectId", projectId);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    },
  });
}

export function createListOpenQuestionsTool(sessionId: string, projectId: string) {
  return tool({
    description:
      "Lista perguntas abertas (default: status=open). Antes de propor algo importante, cheque se há pergunta aberta relevante — se sim, levante antes de seguir.",
    inputSchema: z.object({
      scope: z.enum(["project", "session"]).default("session"),
      status: openQuestionStatusEnum.default("open"),
    }),
    execute: async ({ scope, status }) => {
      let q = db()
        .from("DesignOpenQuestion")
        .select("id, question, blocksWhat, status, answer, createdAt")
        .order("createdAt", { ascending: false });
      if (scope === "session") q = q.eq("sessionId", sessionId);
      else q = q.eq("projectId", projectId);
      q = q.eq("status", status);
      const { data, error } = await q;
      if (error) return { ok: false, error: error.message };
      return { ok: true, openQuestions: data ?? [] };
    },
  });
}

// ─── Research log ───────────────────────────────────────────

export function createListResearchTool(sessionId: string, projectId: string) {
  return tool({
    description:
      "Lista pesquisas (web_search) já realizadas. Use pra recuperar fontes ao citar evidência. Cada entry tem id curto (research#abc) que vai como ref no briefing.",
    inputSchema: z.object({
      scope: z.enum(["project", "session"]).default("session"),
      query: z.string().optional().describe("Filtro fuzzy em query/summary"),
      limit: z.number().min(1).max(50).default(20),
    }),
    execute: async ({ scope, query, limit }) => {
      let q = db()
        .from("DesignSessionResearch")
        .select("id, query, summary, sources, createdAt")
        .order("createdAt", { ascending: false })
        .limit(limit);
      if (scope === "session") q = q.eq("sessionId", sessionId);
      else q = q.eq("projectId", projectId);
      if (query) q = q.or(`query.ilike.%${query}%,summary.ilike.%${query}%`);
      const { data, error } = await q;
      if (error) return { ok: false, error: error.message };
      return {
        ok: true,
        research: (data ?? []).map((r) => ({ ...r, refId: r.id.slice(0, 8) })),
      };
    },
  });
}

// ─── Business Context ───────────────────────────────────────

export function createReadBusinessContextTool(_sessionId: string, projectId: string) {
  return tool({
    description:
      "Lê o contexto de negócio do projeto: businessModel, stage, ICP, ticketRangeBrl, runwayMonths, competitors. Use pra calibrar trade-offs (custo de feature vs ticket médio, urgência vs runway, etc).",
    inputSchema: z.object({}),
    execute: async () => {
      const { data, error } = await db()
        .from("ProjectBusinessContext")
        .select("*")
        .eq("projectId", projectId)
        .maybeSingle();
      if (error) return { ok: false, error: error.message };
      return { ok: true, businessContext: data ?? null };
    },
  });
}
