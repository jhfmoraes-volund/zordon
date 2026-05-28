/**
 * Memory tools — Vitor's structured memory layer.
 *
 * Plan: docs/agents/vitor/vitor-memory-plan.md
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

// ─── Session Markdown Memory ────────────────────────────────

export function createReadSessionMemoryTool(sessionId: string, projectId: string) {
  return tool({
    description:
      "Lê a memória narrativa (markdown) de uma session. Sem sessionId, lê a memória da session atual. Com sessionId, lê de OUTRA session do mesmo projeto — útil pra puxar contexto de inception anterior, CI passada, etc.",
    inputSchema: z.object({
      sessionId: z
        .string()
        .optional()
        .describe(
          "ID de outra session do mesmo projeto (omita pra ler a session atual)",
        ),
    }),
    execute: async ({ sessionId: targetId }) => {
      const target = targetId ?? sessionId;
      const { data, error } = await db()
        .from("DesignSession")
        .select("id, title, type, status, projectId, memoryMd, memoryAbstract, memoryVersion, memoryUpdatedAt")
        .eq("id", target)
        .maybeSingle();
      if (error) return { ok: false, error: error.message };
      if (!data) return { ok: false, error: "session not found" };
      if (data.projectId !== projectId) {
        return { ok: false, error: "session belongs to another project" };
      }
      return {
        ok: true,
        session: {
          id: data.id,
          title: data.title,
          type: data.type,
          status: data.status,
          memoryMd: data.memoryMd ?? "",
          memoryVersion: data.memoryVersion ?? 0,
          memoryUpdatedAt: data.memoryUpdatedAt,
        },
      };
    },
  });
}

const memoryActionSchema = z.enum(["replace", "append_section", "edit_section"]);

function applyMarkdownMutation(
  current: string,
  action: "replace" | "append_section" | "edit_section",
  section: string | undefined,
  content: string,
): string {
  if (action === "replace") return content;
  if (!section) {
    throw new Error("section is required for append_section/edit_section");
  }
  const heading = `## ${section}`;
  const body = current ?? "";
  if (action === "append_section") {
    if (body.includes(heading)) {
      // section already exists — append content after the section header
      const lines = body.split("\n");
      const idx = lines.findIndex((l) => l.trim() === heading);
      const after = lines.slice(idx + 1);
      const nextHeadingOffset = after.findIndex((l) => /^## /.test(l));
      const insertAt = idx + 1 + (nextHeadingOffset === -1 ? after.length : nextHeadingOffset);
      lines.splice(insertAt, 0, content.trim(), "");
      return lines.join("\n");
    }
    return `${body.trim()}\n\n${heading}\n${content.trim()}\n`.trimStart();
  }
  if (action === "edit_section") {
    const lines = body.split("\n");
    const idx = lines.findIndex((l) => l.trim() === heading);
    if (idx === -1) {
      // section doesn't exist yet — fall back to append
      return `${body.trim()}\n\n${heading}\n${content.trim()}\n`.trimStart();
    }
    const after = lines.slice(idx + 1);
    const nextHeadingOffset = after.findIndex((l) => /^## /.test(l));
    const replaceUntil = idx + 1 + (nextHeadingOffset === -1 ? after.length : nextHeadingOffset);
    return [
      ...lines.slice(0, idx + 1),
      content.trim(),
      "",
      ...lines.slice(replaceUntil),
    ].join("\n");
  }
  return current;
}

export function createUpdateSessionMemoryTool(sessionId: string, _projectId: string) {
  return tool({
    description:
      "Atualiza a memória narrativa (markdown) da session atual. Use pra capturar nuance que não cabe em decision/open question: contexto de projeto solto, hipóteses, descartado-e-por-quê. Use seções fixas (Contexto Específico, Personas Estabelecidas, Hipóteses, Pesquisas Relevantes, Descartado). Optimistic lock: passe expectedVersion lido por read_session_memory; se conflitar (web + telegram), retorna newer state e você relê.",
    inputSchema: z.object({
      action: memoryActionSchema,
      section: z
        .string()
        .optional()
        .describe("Nome da seção (sem '## '). Obrigatório em append/edit_section"),
      content: z.string().describe("Conteúdo a inserir/substituir"),
      expectedVersion: z
        .number()
        .int()
        .describe("Versão lida em read_session_memory — protege contra concorrência"),
    }),
    execute: async ({ action, section, content, expectedVersion }) => {
      const { data: current, error: rErr } = await db()
        .from("DesignSession")
        .select("memoryMd, memoryVersion")
        .eq("id", sessionId)
        .single();
      if (rErr) return { ok: false, error: rErr.message };
      if ((current.memoryVersion ?? 0) !== expectedVersion) {
        return {
          ok: false,
          conflict: true,
          currentVersion: current.memoryVersion ?? 0,
          currentMd: current.memoryMd ?? "",
        };
      }

      let updated: string;
      try {
        updated = applyMarkdownMutation(
          current.memoryMd ?? "",
          action,
          section,
          content,
        );
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }

      const newVersion = expectedVersion + 1;
      const abstract = updated.slice(0, 200);
      const { error: uErr } = await db()
        .from("DesignSession")
        .update({
          memoryMd: updated,
          memoryAbstract: abstract,
          memoryVersion: newVersion,
          memoryUpdatedAt: new Date().toISOString(),
        })
        .eq("id", sessionId);
      if (uErr) return { ok: false, error: uErr.message };
      return { ok: true, newVersion, abstract };
    },
  });
}

// ─── Project Memory ─────────────────────────────────────────

export function createReadProjectMemoryTool(_sessionId: string, projectId: string) {
  return tool({
    description:
      "Lê a memória narrativa do PROJETO (cross-session, durável). Inclui businessContext, decisões ativas, perguntas abertas e o markdown agregador. CHAME no início de session nova — abre a conversa reconhecendo o que já existe.",
    inputSchema: z.object({}),
    execute: async () => {
      const [project, ctx, decisions, openQs] = await Promise.all([
        db()
          .from("Project")
          .select("name, memoryMd, memoryVersion, memoryUpdatedAt")
          .eq("id", projectId)
          .single(),
        db()
          .from("ProjectBusinessContext")
          .select("*")
          .eq("projectId", projectId)
          .maybeSingle(),
        db()
          .from("DesignDecision")
          .select("id, statement, rationale, confidence, tags, createdAt")
          .eq("projectId", projectId)
          .eq("status", "active")
          .order("createdAt", { ascending: false }),
        db()
          .from("DesignOpenQuestion")
          .select("id, question, blocksWhat, sessionId, createdAt")
          .eq("projectId", projectId)
          .eq("status", "open")
          .order("createdAt", { ascending: false }),
      ]);

      if (project.error) return { ok: false, error: project.error.message };
      return {
        ok: true,
        project: {
          name: project.data.name,
          memoryMd: project.data.memoryMd ?? "",
          memoryVersion: project.data.memoryVersion ?? 0,
          memoryUpdatedAt: project.data.memoryUpdatedAt,
        },
        businessContext: ctx.data ?? null,
        activeDecisions: decisions.data ?? [],
        openQuestions: openQs.data ?? [],
      };
    },
  });
}

export function createUpdateProjectMemoryTool(_sessionId: string, projectId: string) {
  return tool({
    description:
      "Atualiza a memória narrativa do PROJETO. Use no auto-compact ao fim de session (action=append_section, section='Aprendizados Cruciais') ou pra consolidar Visão de Produto cross-session. Mesmo padrão de optimistic lock que update_session_memory.",
    inputSchema: z.object({
      action: memoryActionSchema,
      section: z.string().optional(),
      content: z.string(),
      expectedVersion: z.number().int(),
    }),
    execute: async ({ action, section, content, expectedVersion }) => {
      const { data: current, error: rErr } = await db()
        .from("Project")
        .select("memoryMd, memoryVersion")
        .eq("id", projectId)
        .single();
      if (rErr) return { ok: false, error: rErr.message };
      if ((current.memoryVersion ?? 0) !== expectedVersion) {
        return {
          ok: false,
          conflict: true,
          currentVersion: current.memoryVersion ?? 0,
          currentMd: current.memoryMd ?? "",
        };
      }

      let updated: string;
      try {
        updated = applyMarkdownMutation(
          current.memoryMd ?? "",
          action,
          section,
          content,
        );
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }

      const newVersion = expectedVersion + 1;
      const { error: uErr } = await db()
        .from("Project")
        .update({
          memoryMd: updated,
          memoryVersion: newVersion,
          memoryUpdatedAt: new Date().toISOString(),
        })
        .eq("id", projectId);
      if (uErr) return { ok: false, error: uErr.message };
      return { ok: true, newVersion };
    },
  });
}

// ─── Cross-session ──────────────────────────────────────────

export function createListProjectSessionsTool(_sessionId: string, projectId: string) {
  return tool({
    description:
      "Lista outras sessions do mesmo projeto (excluindo a atual). Use no início de session nova ou quando o usuário descrever algo que pode existir em session vizinha.",
    inputSchema: z.object({
      includeDrafts: z.boolean().default(false).describe("Inclui status='draft'?"),
    }),
    execute: async ({ includeDrafts }) => {
      let q = db()
        .from("DesignSession")
        .select("id, title, type, status, memoryAbstract, memoryUpdatedAt, updatedAt")
        .eq("projectId", projectId)
        .neq("id", _sessionId)
        .order("updatedAt", { ascending: false });
      if (!includeDrafts) q = q.neq("status", "draft");
      const { data, error } = await q;
      if (error) return { ok: false, error: error.message };
      return { ok: true, sessions: data ?? [] };
    },
  });
}

// ─── Auto-compact (manual trigger) ──────────────────────────

export function createCompactSessionToProjectTool(
  sessionId: string,
  projectId: string,
) {
  return tool({
    description:
      "Compacta o que vale a pena lembrar desta session pra Project Memory. Chame ao FIM da session (status=completed) ou quando o usuário pedir 'encerra essa session'. Você gera bullets de aprendizados e a tool persiste em Project.memoryMd seção 'Aprendizados Cruciais'.",
    inputSchema: z.object({
      learnings: z
        .array(z.string())
        .min(3)
        .describe(
          "3-5 aprendizados cruciais — bullets concretos. Não inclua ruído ('foi uma boa session'), só fatos com valor cross-session.",
        ),
    }),
    execute: async ({ learnings }) => {
      const { data: project, error: rErr } = await db()
        .from("Project")
        .select("memoryMd, memoryVersion")
        .eq("id", projectId)
        .single();
      if (rErr) return { ok: false, error: rErr.message };

      const { data: session } = await db()
        .from("DesignSession")
        .select("title")
        .eq("id", sessionId)
        .maybeSingle();
      const sessionTitle = session?.title ?? "session";
      const date = new Date().toISOString().slice(0, 10);
      const bullets = learnings
        .map((l) => `- ${l} (${date}, via ${sessionTitle})`)
        .join("\n");

      const updated = applyMarkdownMutation(
        project.memoryMd ?? "",
        "append_section",
        "Aprendizados Cruciais",
        bullets,
      );
      const newVersion = (project.memoryVersion ?? 0) + 1;
      const { error: uErr } = await db()
        .from("Project")
        .update({
          memoryMd: updated,
          memoryVersion: newVersion,
          memoryUpdatedAt: new Date().toISOString(),
        })
        .eq("id", projectId);
      if (uErr) return { ok: false, error: uErr.message };
      return { ok: true, learnings, newVersion };
    },
  });
}
