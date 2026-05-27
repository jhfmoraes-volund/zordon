/**
 * DS entity tools — 1 read tool por entidade (Vitor normalization v2).
 *
 * Princípio: cada entidade tem 1 tabela, 1 read tool, 1 write tool.
 * Default seco — sem filtros volta projeção mínima (id + título/nome).
 * Modelo opta-in nos campos pesados via `fields` / `includeJourney`.
 *
 * Plano: docs/agents/vitor/vitor-normalization-plan-v2.md §2.
 */

import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";

// -------------- product_vision (1:1) --------------

export function createReadProductVisionTool(sessionId: string) {
  return tool({
    description:
      "Lê a Product Vision da sessão (1 row). Campos: problem, whoSuffers, consequences, successVision, impactMetrics. Sem args = todos os campos. Não use sem necessidade — Vision em geral já vem no system prompt.",
    inputSchema: z.object({
      fields: z
        .array(
          z.enum(["problem", "whoSuffers", "consequences", "successVision", "impactMetrics"]),
        )
        .optional()
        .describe("Campos a retornar (default: todos)"),
    }),
    execute: async ({ fields }) => {
      const cols = fields?.length
        ? fields.join(", ")
        : "problem, \"whoSuffers\", consequences, \"successVision\", \"impactMetrics\"";
      const { data, error } = await db()
        .from("DesignSessionProductVision")
        .select(cols)
        .eq("sessionId", sessionId)
        .maybeSingle();
      if (error) throw new Error(`read_product_vision: ${error.message}`);
      return { vision: data ?? null };
    },
  });
}

// -------------- scope (1:1, 4 jsonb arrays) --------------

const scopeBucketSchema = z.enum(["inScope", "outOfScope", "does", "doesNot"]);

export function createReadScopeTool(sessionId: string) {
  return tool({
    description:
      "Lê o Scope da sessão (4 listas: inScope, outOfScope, does, doesNot). Sem args = todos. Filtra por buckets se quiser.",
    inputSchema: z.object({
      buckets: z
        .array(scopeBucketSchema)
        .optional()
        .describe("Quais buckets retornar (default: todos)"),
    }),
    execute: async ({ buckets }) => {
      const cols = buckets?.length
        ? buckets.map((b) => `"${b}"`).join(", ")
        : '"inScope", "outOfScope", does, "doesNot"';
      const { data, error } = await db()
        .from("DesignSessionScope")
        .select(cols)
        .eq("sessionId", sessionId)
        .maybeSingle();
      if (error) throw new Error(`read_scope: ${error.message}`);
      return { scope: data ?? null };
    },
  });
}

// -------------- persona (1:N, journey jsonb) --------------

export function createReadPersonaTool(sessionId: string) {
  return tool({
    description:
      "Lê personas da sessão. Default seco: só name + role + id. Pra journey (asIsSteps/toBeSteps), passe includeJourney=true ou fields=['asIsSteps','toBeSteps']. Filtra por ids se quiser personas específicas.",
    inputSchema: z.object({
      ids: z.array(z.string()).optional().describe("Filtra por persona ids"),
      includeJourney: z
        .boolean()
        .optional()
        .describe("Inclui asIsSteps + toBeSteps (default false — pesado)"),
      fields: z
        .array(z.enum(["name", "role", "context", "asIsSteps", "toBeSteps", "orderIndex"]))
        .optional()
        .describe("Campos extras explícitos (sobrescreve includeJourney)"),
    }),
    execute: async ({ ids, includeJourney, fields }) => {
      let cols = "id, name, role";
      if (fields?.length) {
        const extra = fields.filter((f) => !["name", "role"].includes(f));
        if (extra.length) {
          cols += `, ${extra.map((f) => (/^[a-zA-Z]+$/.test(f) ? `"${f}"` : f)).join(", ")}`;
        }
      } else if (includeJourney) {
        cols += ', context, "asIsSteps", "toBeSteps", "orderIndex"';
      }

      let q = db().from("DesignSessionPersona").select(cols).eq("sessionId", sessionId);
      if (ids?.length) q = q.in("id", ids);
      const { data, error } = await q.order("orderIndex", { ascending: true });
      if (error) throw new Error(`read_persona: ${error.message}`);
      return { personas: data ?? [] };
    },
  });
}

// -------------- brainstorm (1:N) --------------

export function createReadBrainstormTool(sessionId: string) {
  return tool({
    description:
      "Lê features do brainstorm. Default seco: id + title. Filtra por ids ou archived. Use fields=['howItSolves','targetPersona','painPointRef',...] pra campos pesados.",
    inputSchema: z.object({
      ids: z.array(z.string()).optional().describe("Filtra por feature ids"),
      includeArchived: z
        .boolean()
        .optional()
        .describe("Inclui archived=true (default false)"),
      fields: z
        .array(
          z.enum([
            "howItSolves",
            "targetPersona",
            "keyScreens",
            "userFlows",
            "painPointRef",
            "technicalNotes",
            "moduleHint",
            "bucket",
            "archived",
            "orderIndex",
          ]),
        )
        .optional()
        .describe("Campos extras a incluir"),
    }),
    execute: async ({ ids, includeArchived, fields }) => {
      let cols = "id, title";
      if (fields?.length) {
        cols += `, ${fields.map((f) => `"${f}"`).join(", ")}`;
      }
      let q = db().from("DesignSessionBrainstormFeature").select(cols).eq("sessionId", sessionId);
      if (ids?.length) q = q.in("id", ids);
      if (!includeArchived) q = q.eq("archived", false);
      const { data, error } = await q.order("orderIndex", { ascending: true });
      if (error) throw new Error(`read_brainstorm: ${error.message}`);
      return { features: data ?? [] };
    },
  });
}

// -------------- priority (1:N) --------------

const priorityBucketSchema = z.enum(["mvp", "next", "out"]);

export function createReadPriorityTool(sessionId: string) {
  return tool({
    description:
      "Lê itens de priorização (mvp/next/out). Default seco: id + title + bucket. Filtra por buckets ou ids. Use fields=['howItSolves','targetPersona','painPointRef',...] pra campos pesados.",
    inputSchema: z.object({
      ids: z.array(z.string()).optional(),
      buckets: z
        .array(priorityBucketSchema)
        .optional()
        .describe("Filtra por buckets (default: todos)"),
      fields: z
        .array(
          z.enum([
            "howItSolves",
            "targetPersona",
            "keyScreens",
            "userFlows",
            "painPointRef",
            "technicalNotes",
            "orderIndex",
          ]),
        )
        .optional(),
    }),
    execute: async ({ ids, buckets, fields }) => {
      let cols = "id, title, bucket";
      if (fields?.length) {
        cols += `, ${fields.map((f) => `"${f}"`).join(", ")}`;
      }
      let q = db().from("DesignSessionPriorityItem").select(cols).eq("sessionId", sessionId);
      if (ids?.length) q = q.in("id", ids);
      if (buckets?.length) q = q.in("bucket", buckets);
      const { data, error } = await q.order("orderIndex", { ascending: true });
      if (error) throw new Error(`read_priority: ${error.message}`);
      return { items: data ?? [] };
    },
  });
}

// -------------- risk (1:N) --------------

export function createReadRiskTool(sessionId: string) {
  return tool({
    description:
      "Lê riscos (business/technical, severity high/medium/low). Default seco: id + text + severity. Filtra por severities.",
    inputSchema: z.object({
      ids: z.array(z.string()).optional(),
      severities: z.array(z.enum(["high", "medium", "low"])).optional(),
      categories: z.array(z.enum(["business", "technical"])).optional(),
      fields: z
        .array(z.enum(["category", "relatedFeature", "mitigation", "orderIndex"]))
        .optional(),
    }),
    execute: async ({ ids, severities, categories, fields }) => {
      let cols = "id, text, severity";
      if (fields?.length) cols += `, ${fields.map((f) => `"${f}"`).join(", ")}`;
      let q = db().from("DesignSessionRisk").select(cols).eq("sessionId", sessionId);
      if (ids?.length) q = q.in("id", ids);
      if (severities?.length) q = q.in("severity", severities);
      if (categories?.length) q = q.in("category", categories);
      const { data, error } = await q.order("orderIndex", { ascending: true });
      if (error) throw new Error(`read_risk: ${error.message}`);
      return { risks: data ?? [] };
    },
  });
}

// -------------- gap (1:N) --------------

export function createReadGapTool(sessionId: string) {
  return tool({
    description:
      "Lê gaps (lacunas de conhecimento). Default seco: id + text. Filtra por ids.",
    inputSchema: z.object({
      ids: z.array(z.string()).optional(),
      fields: z
        .array(z.enum(["category", "severity", "relatedFeature", "mitigation", "orderIndex"]))
        .optional(),
    }),
    execute: async ({ ids, fields }) => {
      let cols = "id, text";
      if (fields?.length) cols += `, ${fields.map((f) => `"${f}"`).join(", ")}`;
      let q = db().from("DesignSessionGap").select(cols).eq("sessionId", sessionId);
      if (ids?.length) q = q.in("id", ids);
      const { data, error } = await q.order("orderIndex", { ascending: true });
      if (error) throw new Error(`read_gap: ${error.message}`);
      return { gaps: data ?? [] };
    },
  });
}

// -------------- tech_specs (1:1 + 2 jsonb arrays) --------------

export function createReadTechSpecsTool(sessionId: string) {
  return tool({
    description:
      "Lê technical specs: stack, performance, integrations (jsonb), rules (jsonb). Sem args = tudo.",
    inputSchema: z.object({
      fields: z
        .array(z.enum(["stack", "performance", "integrations", "rules"]))
        .optional(),
    }),
    execute: async ({ fields }) => {
      const cols = fields?.length
        ? fields.map((f) => `"${f}"`).join(", ")
        : "stack, performance, integrations, rules";
      const { data, error } = await db()
        .from("DesignSessionTechnicalSpecs")
        .select(cols)
        .eq("sessionId", sessionId)
        .maybeSingle();
      if (error) throw new Error(`read_tech_specs: ${error.message}`);
      return { specs: data ?? null };
    },
  });
}

// -------------- hypothesis (1:N) --------------

export function createReadHypothesisTool(sessionId: string) {
  return tool({
    description:
      "Lê hipóteses. Default seco: id + hypothesis. Use fields=['indicator','target','expectedResult','evidence'] pra detalhes.",
    inputSchema: z.object({
      ids: z.array(z.string()).optional(),
      fields: z
        .array(
          z.enum(["indicator", "target", "expectedResult", "evidence", "orderIndex"]),
        )
        .optional(),
    }),
    execute: async ({ ids, fields }) => {
      let cols = "id, hypothesis";
      if (fields?.length) cols += `, ${fields.map((f) => `"${f}"`).join(", ")}`;
      let q = db().from("DesignSessionHypothesis").select(cols).eq("sessionId", sessionId);
      if (ids?.length) q = q.in("id", ids);
      const { data, error } = await q.order("orderIndex", { ascending: true });
      if (error) throw new Error(`read_hypothesis: ${error.message}`);
      return { hypotheses: data ?? [] };
    },
  });
}

// -------------- files (read-only — upload é UI) --------------

interface LegacyPreWorkFile {
  id: string;
  name: string;
  size?: number;
  type?: string;
  extractedText?: string;
}

/**
 * Combina DesignSessionFile (canônico) + DesignSessionStepData[pre_work].files (legado).
 * Durante a transição, ambos existem; depois do drop em PR3, só DesignSessionFile.
 */
async function loadFilesUnified(sessionId: string): Promise<
  Array<{
    id: string;
    name: string;
    size: number;
    mimeType: string;
    hasText: boolean;
    source: "table" | "legacy";
  }>
> {
  const result: Array<{
    id: string;
    name: string;
    size: number;
    mimeType: string;
    hasText: boolean;
    source: "table" | "legacy";
  }> = [];

  const { data: tableFiles } = await db()
    .from("DesignSessionFile")
    .select("id, name, size, mimeType, extractedText, extractionStatus")
    .eq("sessionId", sessionId);
  for (const f of tableFiles ?? []) {
    result.push({
      id: f.id,
      name: f.name,
      size: Number(f.size ?? 0),
      mimeType: f.mimeType ?? "",
      hasText: f.extractionStatus === "success" && !!f.extractedText,
      source: "table",
    });
  }

  // Legacy fallback — DesignSessionStepData[pre_work].data.files
  const { data: legacyRow } = await db()
    .from("DesignSessionStepData")
    .select("data")
    .eq("sessionId", sessionId)
    .eq("stepKey", "pre_work")
    .maybeSingle();
  const legacyFiles = (legacyRow?.data as { files?: LegacyPreWorkFile[] } | null)?.files ?? [];
  for (const f of legacyFiles) {
    if (result.some((r) => r.id === f.id)) continue;
    result.push({
      id: f.id,
      name: f.name,
      size: Number(f.size ?? 0),
      mimeType: f.type ?? "",
      hasText: !!f.extractedText && f.extractedText.length > 0,
      source: "legacy",
    });
  }
  return result;
}

export function createReadFilesTool(sessionId: string) {
  return tool({
    description:
      "Lista arquivos persistidos na sessão (pre_work + uploads). Default seco: id + name + size + mimeType + hasText. NÃO retorna o texto — use read_file_text({fileId}) pra ler conteúdo.",
    inputSchema: z.object({}),
    execute: async () => {
      const files = await loadFilesUnified(sessionId);
      return { files };
    },
  });
}

export function createReadFileTextTool(sessionId: string) {
  return tool({
    description:
      "Lê texto extraído de um arquivo. Use range=[from,to] (linhas, 1-indexed) pra paginar arquivos grandes — default são as primeiras 200 linhas. Use search_doc se quiser buscar trecho específico em vez de paginar.",
    inputSchema: z.object({
      fileId: z.string(),
      range: z
        .tuple([z.number().int().positive(), z.number().int().positive()])
        .optional()
        .describe("[fromLine, toLine] 1-indexed (default [1, 200])"),
    }),
    execute: async ({ fileId, range }) => {
      // try canonical first
      const { data: row } = await db()
        .from("DesignSessionFile")
        .select("id, name, mimeType, extractedText, extractionStatus")
        .eq("sessionId", sessionId)
        .eq("id", fileId)
        .maybeSingle();

      let name = row?.name;
      let mimeType = row?.mimeType;
      let text = row?.extractedText ?? null;
      let status = row?.extractionStatus ?? null;

      if (!text) {
        // legacy fallback
        const { data: legacyRow } = await db()
          .from("DesignSessionStepData")
          .select("data")
          .eq("sessionId", sessionId)
          .eq("stepKey", "pre_work")
          .maybeSingle();
        const legacyFiles =
          (legacyRow?.data as { files?: LegacyPreWorkFile[] } | null)?.files ?? [];
        const legacy = legacyFiles.find((f) => f.id === fileId);
        if (legacy) {
          name = legacy.name;
          mimeType = legacy.type;
          text = legacy.extractedText ?? "";
          status = text ? "success" : "pending";
        }
      }

      if (text === null) {
        return { ok: false, error: `file ${fileId} not found in this session` };
      }
      if (!text) {
        return { ok: false, error: `file has no extracted text (status: ${status})`, name, mimeType };
      }

      const lines = text.split("\n");
      const [from, to] = range ?? [1, 200];
      const sliced = lines.slice(Math.max(0, from - 1), Math.min(lines.length, to));
      return {
        ok: true,
        name,
        mimeType,
        totalLines: lines.length,
        from,
        to: Math.min(lines.length, to),
        text: sliced.join("\n"),
        truncated: to < lines.length,
      };
    },
  });
}
