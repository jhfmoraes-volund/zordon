import "server-only";
import { createHash } from "crypto";
import { generateText } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { db } from "@/lib/db";
import { getModel, DEFAULT_MODEL } from "@/lib/ai/provider";
import { recordSubAgentUsage } from "@/lib/agent/usage";
import {
  RawObjectivesSchema,
  RawHighlightsSchema,
  type NarrativeSectionKey,
  type RawBullet,
  type SourceRef,
} from "@/lib/wiki/schemas";
import { computeBulletHash } from "@/lib/wiki/suppressed";

/**
 * WikiComposer (PRD project-wiki WIKI-009..012, emendas do runbook
 * drive-context-wiki-pipeline):
 *   D8  — roda como módulo Next (não Edge Deno): adapters/Composio vivem aqui.
 *   D9  — job state em WikiJob (tabela), não Map in-memory.
 *   D11 — hash guard: inputsHash por seção pula o LLM quando nada mudou.
 *   WIKI-010 emenda — pool de ContextSource do projeto entra no contexto.
 *
 * Regra grounded (runbook §8): bullet sem ref tipada validável não persiste.
 */

type Supabase = SupabaseClient<Database>;

// ── Contexto ────────────────────────────────────────────────

type ContextItem = {
  ref: SourceRef;
  label: string;
  body: string;
};

type WikiContext = {
  inceptionDS: ContextItem | null;
  completedTasks: ContextItem[];
  pmReviews: ContextItem[];
  contextSources: ContextItem[];
};

const WINDOW_DAYS = 14;
const TRANSCRIPT_TRUNCATE = 3000;
const SOURCE_TEXT_TRUNCATE = 8000;
const SOURCES_TOTAL_BUDGET = 80_000;
/** Descrição da task no contexto de highlights — curta (não é a fonte primária). */
const TASK_DESC_TRUNCATE = 400;

/** head+tail — preserva começo e fim quando corta. */
function truncateMid(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor((max - 20) / 2);
  return `${text.slice(0, half)}\n[...corte...]\n${text.slice(-half)}`;
}

export async function loadWikiContext(
  supabase: Supabase,
  projectId: string
): Promise<WikiContext> {
  const windowStart = new Date(
    Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const [dsRes, tasksRes, pmRes, sourcesRes] = await Promise.all([
    supabase
      .from("DesignSession")
      .select("id, title, description, memoryMd, completedAt")
      .eq("projectId", projectId)
      .in("type", ["inception", "inception-v2"])
      .eq("status", "completed")
      .order("completedAt", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("Task")
      .select("id, title, description, doneAt, functionPoints")
      .eq("projectId", projectId)
      .eq("status", "done")
      .gte("doneAt", windowStart)
      .order("doneAt", { ascending: false })
      .limit(30),
    supabase
      .from("PMReview")
      .select("id, referenceWeek, reportMarkdown, publishedAt")
      .eq("projectId", projectId)
      .not("publishedAt", "is", null)
      .order("publishedAt", { ascending: false })
      .limit(2),
    supabase
      .from("ContextSource")
      .select("id, kind, title, summary, fullText, capturedAt, createdAt")
      .eq("projectId", projectId)
      .order("capturedAt", { ascending: false, nullsFirst: false }),
  ]);

  const ds = dsRes.data;
  const inceptionDS: ContextItem | null = ds
    ? {
        ref: { type: "design_session", id: ds.id },
        label: `DS Inception "${ds.title}" (aprovada em ${ds.completedAt?.slice(0, 10) ?? "?"})`,
        body: truncateMid(
          [ds.description, ds.memoryMd].filter(Boolean).join("\n\n") ||
            "(sem conteúdo)",
          TRANSCRIPT_TRUNCATE
        ),
      }
    : null;

  const completedTasks = (tasksRes.data ?? []).map((t) => ({
    ref: { type: "task" as const, id: t.id },
    label: `Task concluída "${t.title}" (${t.doneAt?.slice(0, 10) ?? "?"}${t.functionPoints ? `, ${t.functionPoints} PFV` : ""})`,
    // Descrição curta dá substância ao highlight (antes era só o título).
    body: t.description ? truncateMid(t.description, TASK_DESC_TRUNCATE) : "",
  }));

  const pmReviews = (pmRes.data ?? []).map((r) => ({
    ref: { type: "pm_review" as const, id: r.id },
    label: `PM Review (semana ${r.referenceWeek})`,
    body: truncateMid(r.reportMarkdown ?? "(sem report)", TRANSCRIPT_TRUNCATE),
  }));

  // Pool de insumos (emenda WIKI-010): trunca cada fullText em ~8k e o total
  // em ~80k priorizando snapshot mais recente; loga o corte.
  const contextSources: ContextItem[] = [];
  let budget = SOURCES_TOTAL_BUDGET;
  let dropped = 0;
  for (const s of sourcesRes.data ?? []) {
    const text = truncateMid(
      s.fullText || s.summary || "(sem texto extraído)",
      SOURCE_TEXT_TRUNCATE
    );
    if (text.length > budget) {
      dropped += 1;
      continue;
    }
    budget -= text.length;
    contextSources.push({
      ref: { type: "context_source", id: s.id },
      label: `Documento [${s.kind}] "${s.title}" (snapshot ${(s.capturedAt ?? s.createdAt).slice(0, 10)})`,
      body: text,
    });
  }
  if (dropped > 0) {
    console.warn(
      `[wiki-composer] pool de sources estourou ${SOURCES_TOTAL_BUDGET} chars — ${dropped} source(s) fora do prompt (projeto ${projectId})`
    );
  }

  return { inceptionDS, completedTasks, pmReviews, contextSources };
}

// ── Hash guard (D11) ────────────────────────────────────────

function computeInputsHash(items: ContextItem[]): string {
  // Sem label (carrega data do snapshot) e sem linhas "Capturado em:" do
  // corpo (gsheets/notion embedam timestamp) — senão o refresh noturno do
  // cron muda o hash toda noite e paga LLM sem mudança real de conteúdo.
  const canonical = items.map((i) => ({
    ref: i.ref,
    body: i.body.replace(/^\*\*Capturado em:\*\*.*$/gm, ""),
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

// ── Prompts ─────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você compõe a Wiki executiva de um projeto da Volund (software house ágil, sprints semanais).

Regras invioláveis:
1. GROUNDED: só afirme o que os insumos evidenciam. Nada de inferência criativa.
2. Cada bullet cita exatamente UMA fonte da lista de insumos, copiando "type" e "id" LITERALMENTE do cabeçalho [type=... id=...] do insumo usado.
3. Texto de bullet: curto (máx 240 caracteres), factual, em português brasileiro.
4. Se os insumos não evidenciam nada para o pedido, devolva listas vazias — não invente.
5. Responda APENAS com JSON válido no shape pedido. Sem markdown, sem comentários.`;

function renderItems(items: ContextItem[]): string {
  if (items.length === 0) return "(nenhum insumo nesta categoria)";
  return items
    .map(
      (i) =>
        `[type=${i.ref.type} id=${i.ref.id}] ${i.label}${i.body ? `\n${i.body}` : ""}`
    )
    .join("\n\n---\n\n");
}

type SectionSpec = {
  key: NarrativeSectionKey;
  title: string;
  /** Ordem default no insert (keys novas; 'objectives' já existe nos defaults). */
  order: number;
  inputs: (ctx: WikiContext) => ContextItem[];
  userPrompt: (items: ContextItem[]) => string;
  /** Clampa arrays ANTES do Zod (leniência com modelo verboso) e valida. */
  parse: (raw: unknown) =>
    | { ok: true; bullets: RawBullet[]; data: Record<string, unknown> }
    | { ok: false; error: string };
};

function clampArray<T>(arr: unknown, max: number): T[] {
  return (Array.isArray(arr) ? arr : []).slice(0, max) as T[];
}

const SECTIONS: SectionSpec[] = [
  {
    key: "objectives",
    title: "Objetivos",
    order: 7,
    inputs: (ctx) =>
      [ctx.inceptionDS, ...ctx.contextSources].filter(
        (i): i is ContextItem => i !== null
      ),
    userPrompt: (items) => `Extraia os OBJETIVOS do projeto a partir dos insumos (fonte primária: DS de Inception; documentos do pool complementam).

Shape exato da resposta:
{"problem":{"text":"...","source":{"type":"...","id":"..."}},"vision":{"text":"...","source":{"type":"...","id":"..."}},"success_signals":[{"text":"...","source":{"type":"...","id":"..."}}]}

- "problem": o problema concreto e específico que o projeto resolve (não abstrato, não genérico).
- "vision": a visão/solução em UMA frase — o que o produto é/faz.
- "success_signals": até 5 sinais de sucesso evidenciados; prefira os mensuráveis/verificáveis.

Insumos:

${renderItems(items)}`,
    parse: (raw) => {
      const r = raw as Record<string, unknown>;
      const clamped = {
        ...r,
        success_signals: clampArray(r?.success_signals, 5),
      };
      const parsed = RawObjectivesSchema.safeParse(clamped);
      if (!parsed.success) return { ok: false, error: parsed.error.message };
      return {
        ok: true,
        bullets: [
          parsed.data.problem,
          parsed.data.vision,
          ...parsed.data.success_signals,
        ],
        data: parsed.data,
      };
    },
  },
  {
    key: "highlights",
    title: "Highlights da semana",
    order: 8,
    inputs: (ctx) => [
      ...ctx.pmReviews,
      ...ctx.completedTasks,
      ...ctx.contextSources,
    ],
    userPrompt: (items) => `Extraia os HIGHLIGHTS recentes do projeto (entregas, marcos, avanços concretos das últimas 2 semanas).

Critérios (leitura executiva — escolha com curadoria, não liste tudo):
- PRIORIZE por impacto: entregas/marcos que movem o projeto à frente. Ignore tarefas triviais ou rotineiras.
- ORDENE do mais significativo para o menos.
- Quando o insumo evidenciar, inclua dado concreto (data, PFV, "em produção", número).
- DEDUPLICAR: se a mesma entrega aparece em mais de um insumo (ex: task + PM review), faça UM bullet só.

Shape exato da resposta (máx 5 bullets, os mais relevantes):
{"bullets":[{"text":"...","source":{"type":"...","id":"..."}}]}

Insumos:

${renderItems(items)}`,
    parse: (raw) => {
      const r = raw as Record<string, unknown>;
      const clamped = { bullets: clampArray(r?.bullets, 5) };
      const parsed = RawHighlightsSchema.safeParse(clamped);
      if (!parsed.success) return { ok: false, error: parsed.error.message };
      return { ok: true, bullets: parsed.data.bullets, data: parsed.data };
    },
  },
  // 'decisions' saiu (WER-006): decisões viram evento no log de Atividade.
];

// ── LLM ─────────────────────────────────────────────────────

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function parseJson(text: string): unknown | null {
  const cleaned = stripFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/**
 * O modelo às vezes inventa o `source.type` (ex: "documento") mesmo copiando
 * o id certo. O id é a chave de grounding — corrige o type server-side a
 * partir do mapa de insumos, recursivamente, antes do Zod.
 */
function normalizeSourceTypes(
  node: unknown,
  typeById: Map<string, SourceRef["type"]>
): void {
  if (Array.isArray(node)) {
    for (const item of node) normalizeSourceTypes(item, typeById);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const obj = node as Record<string, unknown>;
  const source = obj.source as { id?: unknown; type?: unknown } | undefined;
  if (source && typeof source.id === "string") {
    const known = typeById.get(source.id);
    if (known) source.type = known;
  }
  for (const value of Object.values(obj)) {
    normalizeSourceTypes(value, typeById);
  }
}

/** Mock determinístico pra teste local sem gastar LLM (WIKI-011). */
function dryRunOutput(spec: SectionSpec, items: ContextItem[]): unknown {
  const src = items[0]?.ref ?? { type: "context_source", id: "" };
  const bullet = { text: `[dry-run] ${spec.title}`, source: src };
  if (spec.key === "objectives") {
    return { problem: bullet, vision: bullet, success_signals: [bullet] };
  }
  return { bullets: [bullet] };
}

async function callSectionLLM(
  projectId: string,
  spec: SectionSpec,
  items: ContextItem[]
): Promise<unknown | { llmError: string }> {
  if (process.env.WIKI_DRY_RUN === "1") return dryRunOutput(spec, items);

  const startedAt = Date.now();
  try {
    const result = await generateText({
      model: getModel(DEFAULT_MODEL),
      system: SYSTEM_PROMPT,
      prompt: spec.userPrompt(items),
    });
    void recordSubAgentUsage({
      agentName: `wiki-composer-${spec.key}`,
      callKind: "other",
      modelId: DEFAULT_MODEL,
      threadId: null,
      memberId: null,
      projectId,
      usage: result.usage,
      providerMetadata: result.providerMetadata,
      generationId: result.response?.id ?? null,
      latencyMs: Date.now() - startedAt,
    });
    const parsed = parseJson(result.text);
    if (parsed === null) {
      return { llmError: `output não-JSON (seção ${spec.key})` };
    }
    return parsed;
  } catch (err) {
    return {
      llmError: err instanceof Error ? err.message : "LLM call failed",
    };
  }
}

// ── Persist (WIKI-012) ──────────────────────────────────────

async function persistWikiSection(
  supabase: Supabase,
  projectId: string,
  spec: SectionSpec,
  data: Record<string, unknown>,
  sources: Array<{ bulletHash: string; sourceType: string; sourceId: string }>,
  inputsHash: string,
  trigger: "manual" | "cron"
): Promise<void> {
  const now = new Date().toISOString();

  const { data: existing, error: selectError } = await supabase
    .from("ProjectWikiSection")
    .select("id, suppressed")
    .eq("projectId", projectId)
    .eq("sectionKey", spec.key)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);

  let sectionId: string;
  if (existing) {
    // suppressed é preservado: o UPDATE não toca na coluna.
    const { error } = await supabase
      .from("ProjectWikiSection")
      .update({
        data: data as Json,
        generatedAt: now,
        generatedBy: trigger,
        schemaVersion: 1,
        inputsHash,
        updatedAt: now,
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    sectionId = existing.id;
  } else {
    const { data: inserted, error } = await supabase
      .from("ProjectWikiSection")
      .insert({
        projectId,
        sectionKey: spec.key,
        title: spec.title,
        order: spec.order,
        data: data as Json,
        generatedAt: now,
        generatedBy: trigger,
        schemaVersion: 1,
        inputsHash,
        updatedAt: now,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      throw new Error(error?.message ?? "insert ProjectWikiSection falhou");
    }
    sectionId = inserted.id;
  }

  // Sources antigas saem antes das novas (refs refletem a geração corrente).
  const { error: deleteError } = await supabase
    .from("ProjectWikiSectionSource")
    .delete()
    .eq("wikiSectionId", sectionId);
  if (deleteError) throw new Error(deleteError.message);

  if (sources.length > 0) {
    const { error: insertError } = await supabase
      .from("ProjectWikiSectionSource")
      .insert(
        sources.map((s) => ({
          wikiSectionId: sectionId,
          bulletHash: s.bulletHash,
          sourceType: s.sourceType,
          sourceId: s.sourceId,
        }))
      );
    if (insertError) throw new Error(insertError.message);
  }
}

// ── Bullets → data persistível ──────────────────────────────

/**
 * Valida grounding (source.id precisa existir nos insumos), descarta bullet
 * sem ref válida (runbook §8) e injeta bulletHash em cada bullet do shape.
 */
function groundAndHash(
  spec: SectionSpec,
  data: Record<string, unknown>,
  bullets: RawBullet[],
  allowedIds: Set<string>
): {
  data: Record<string, unknown>;
  sources: Array<{ bulletHash: string; sourceType: string; sourceId: string }>;
  discarded: number;
} {
  let discarded = 0;
  const sources: Array<{
    bulletHash: string;
    sourceType: string;
    sourceId: string;
  }> = [];

  const enrich = (bullet: RawBullet): (RawBullet & { bulletHash: string }) | null => {
    if (!bullet?.source?.id || !allowedIds.has(bullet.source.id)) {
      discarded += 1;
      return null;
    }
    const bulletHash = computeBulletHash(bullet.text, bullet.source.id);
    sources.push({
      bulletHash,
      sourceType: bullet.source.type,
      sourceId: bullet.source.id,
    });
    return { ...bullet, bulletHash };
  };

  let out: Record<string, unknown>;
  if (spec.key === "objectives") {
    const problem = enrich(data.problem as RawBullet);
    const vision = enrich(data.vision as RawBullet);
    const signals = ((data.success_signals as RawBullet[]) ?? [])
      .map(enrich)
      .filter(Boolean);
    out = { problem, vision, success_signals: signals };
  } else {
    const enriched = bullets.map(enrich).filter(Boolean);
    out = { ...data, bullets: enriched };
  }

  if (discarded > 0) {
    console.warn(
      `[wiki-composer] ${discarded} bullet(s) descartado(s) por ref inválida (seção ${spec.key})`
    );
  }
  return { data: out, sources, discarded };
}

// ── Orquestração ────────────────────────────────────────────

export type ComposeResult = {
  projectId: string;
  sections: Record<string, "generated" | "skipped" | "empty" | "error">;
  errors: string[];
};

export async function composeWiki(
  projectId: string,
  jobId: string | null,
  trigger: "manual" | "cron" = "manual"
): Promise<ComposeResult> {
  const supabase = db();
  const result: ComposeResult = { projectId, sections: {}, errors: [] };

  if (jobId) {
    await supabase
      .from("WikiJob")
      .update({ status: "running", startedAt: new Date().toISOString() })
      .eq("id", jobId);
  }

  try {
    const ctx = await loadWikiContext(supabase, projectId);

    const { data: existingSections } = await supabase
      .from("ProjectWikiSection")
      .select("sectionKey, inputsHash")
      .eq("projectId", projectId);
    const hashByKey = new Map(
      (existingSections ?? []).map((s) => [s.sectionKey, s.inputsHash])
    );

    for (const spec of SECTIONS) {
      const items = spec.inputs(ctx);

      if (items.length === 0) {
        // Fallback gracioso: sem insumo → não persiste; UI mostra CTA.
        result.sections[spec.key] = "empty";
        continue;
      }

      const inputsHash = computeInputsHash(items);
      if (hashByKey.get(spec.key) === inputsHash) {
        console.log(
          `[wiki-composer] hash guard: seção ${spec.key} sem mudança de insumos — skip (projeto ${projectId})`
        );
        result.sections[spec.key] = "skipped";
        continue;
      }

      const raw = await callSectionLLM(projectId, spec, items);
      if (raw && typeof raw === "object" && "llmError" in raw) {
        result.sections[spec.key] = "error";
        result.errors.push(`${spec.key}: ${(raw as { llmError: string }).llmError}`);
        continue;
      }

      const typeById = new Map(items.map((i) => [i.ref.id, i.ref.type]));
      normalizeSourceTypes(raw, typeById);
      const parsed = spec.parse(raw);
      if (!parsed.ok) {
        // Output inválido → mantém versão anterior + log (PRD §6.3).
        console.error(
          `[wiki-composer] schema inválido (seção ${spec.key}): ${parsed.error.slice(0, 500)}\n  raw: ${JSON.stringify(raw).slice(0, 1500)}`
        );
        result.sections[spec.key] = "error";
        result.errors.push(`${spec.key}: output fora do schema`);
        continue;
      }

      const allowedIds = new Set(items.map((i) => i.ref.id));
      const grounded = groundAndHash(spec, parsed.data, parsed.bullets, allowedIds);

      await persistWikiSection(
        supabase,
        projectId,
        spec,
        grounded.data,
        grounded.sources,
        inputsHash,
        trigger
      );
      result.sections[spec.key] = "generated";
    }

    const anyOk = Object.values(result.sections).some(
      (s) => s === "generated" || s === "skipped" || s === "empty"
    );
    if (jobId) {
      await supabase
        .from("WikiJob")
        .update({
          status: anyOk ? "done" : "failed",
          error: result.errors.length > 0 ? result.errors.join("; ") : null,
          finishedAt: new Date().toISOString(),
        })
        .eq("id", jobId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "compose falhou";
    result.errors.push(message);
    console.error(`[wiki-composer] compose falhou (projeto ${projectId}):`, err);
    if (jobId) {
      await supabase
        .from("WikiJob")
        .update({
          status: "failed",
          error: message,
          finishedAt: new Date().toISOString(),
        })
        .eq("id", jobId);
    }
  }

  return result;
}
