/**
 * Wiki copiloto tools (WCP-003) — Vitoria afina a Wiki por chat, GROUNDED.
 *
 * Doutrina: poucas tools afiadas. SENSE (read_wiki) + ACT (set_wiki_emphasis,
 * suppress/restore_wiki_bullet, recompose_wiki). Nenhuma escreve texto livre
 * direto na Wiki — só orientam/curam a geração grounded.
 *
 * projectId/memberId vêm por closure (nunca input — doutrina D13).
 */

import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseSuppressed, type SuppressedEntry } from "@/lib/wiki/suppressed";
import { getWikiEmphasis, setWikiEmphasis } from "@/lib/dal/wiki-emphasis";

const WIKI_SECTION_KEYS = ["objectives", "highlights"] as const;

type FlatBullet = { bulletHash: string; text: string; suppressed: boolean };

/** Achata o data de uma seção em bullets {hash, text}, marcando suprimidos. */
function flattenSection(
  sectionKey: string,
  data: unknown,
  suppressed: SuppressedEntry[],
): FlatBullet[] {
  const suppressedHashes = new Set(suppressed.map((s) => s.bulletHash));
  const d = (data ?? {}) as Record<string, unknown>;
  const out: FlatBullet[] = [];
  const push = (b: unknown, prefix?: string) => {
    const bullet = b as { text?: string; bulletHash?: string } | null;
    if (bullet?.bulletHash && bullet.text) {
      out.push({
        bulletHash: bullet.bulletHash,
        text: prefix ? `${prefix}: ${bullet.text}` : bullet.text,
        suppressed: suppressedHashes.has(bullet.bulletHash),
      });
    }
  };
  if (sectionKey === "objectives") {
    push(d.problem, "Problema");
    push(d.vision, "Visão");
    for (const s of (d.success_signals as unknown[]) ?? []) push(s, "Sinal");
  } else {
    for (const b of (d.bullets as unknown[]) ?? []) push(b);
  }
  return out;
}

// ── SENSE ───────────────────────────────────────────────────

export function createReadWikiTool(projectId: string) {
  return tool({
    description:
      "Lê a Wiki atual do projeto: bullets de Objetivos e Highlights (com bulletHash pra agir), quais estão ocultos, e a ênfase vigente do PM. Use ANTES de propor qualquer ajuste — olhe a realidade primeiro.",
    inputSchema: z.object({}),
    execute: async () => {
      const supabase = db();
      const [{ data: rows }, emphasis] = await Promise.all([
        supabase
          .from("ProjectWikiSection")
          .select("sectionKey, data, suppressed, generatedAt")
          .eq("projectId", projectId)
          .in("sectionKey", [...WIKI_SECTION_KEYS]),
        getWikiEmphasis(supabase, projectId),
      ]);
      const sections = (rows ?? []).map((r) => ({
        sectionKey: r.sectionKey,
        generatedAt: r.generatedAt,
        bullets: flattenSection(
          r.sectionKey,
          r.data,
          parseSuppressed(r.suppressed),
        ),
      }));
      return { ok: true, emphasis: emphasis || null, sections };
    },
  });
}

// ── ACT ─────────────────────────────────────────────────────

export function createSetWikiEmphasisTool(
  projectId: string,
  memberId: string | null,
) {
  return tool({
    description:
      "Define a ÊNFASE do PM pra Wiki: uma orientação livre que o composer honra em TODA geração (persiste, não é edição pontual). Ex: 'priorize a migração legada' ou 'o objetivo deve focar em compliance'. NÃO escreve texto na Wiki — orienta o que destacar; o conteúdo continua grounded. Depois chame recompose_wiki pra aplicar.",
    inputSchema: z.object({
      emphasis: z
        .string()
        .max(2000)
        .describe(
          "A orientação (curta). String vazia limpa a ênfase. Não invente fatos — isto só re-prioriza o que as fontes evidenciam.",
        ),
    }),
    execute: async ({ emphasis }) => {
      await setWikiEmphasis(db(), projectId, emphasis, memberId);
      return { ok: true, emphasis };
    },
  });
}

export function createSuppressWikiBulletTool(
  projectId: string,
  memberId: string | null,
) {
  return tool({
    description:
      "Oculta um bullet da Wiki por bulletHash (pegue de read_wiki). Idempotente. O bullet volta se a fonte mudar numa próxima geração.",
    inputSchema: z.object({
      sectionKey: z.enum(WIKI_SECTION_KEYS),
      bulletHash: z.string().min(1).describe("bulletHash vindo de read_wiki"),
    }),
    execute: async ({ sectionKey, bulletHash }) => {
      const supabase = db();
      const { data: section } = await supabase
        .from("ProjectWikiSection")
        .select("id, suppressed")
        .eq("projectId", projectId)
        .eq("sectionKey", sectionKey)
        .maybeSingle();
      if (!section) return { ok: false, error: "Seção não encontrada" };
      const suppressed = parseSuppressed(section.suppressed);
      if (!suppressed.some((s) => s.bulletHash === bulletHash)) {
        suppressed.push({
          bulletHash,
          suppressedBy: memberId ?? "vitoria",
          suppressedAt: new Date().toISOString(),
        });
        const { error } = await supabase
          .from("ProjectWikiSection")
          .update({ suppressed: suppressed as never, updatedAt: new Date().toISOString() })
          .eq("id", section.id);
        if (error) return { ok: false, error: error.message };
      }
      return { ok: true, suppressed };
    },
  });
}

export function createRestoreWikiBulletTool(projectId: string) {
  return tool({
    description:
      "Reexibe um bullet antes oculto (remove o suppress) por bulletHash.",
    inputSchema: z.object({
      sectionKey: z.enum(WIKI_SECTION_KEYS),
      bulletHash: z.string().min(1),
    }),
    execute: async ({ sectionKey, bulletHash }) => {
      const supabase = db();
      const { data: section } = await supabase
        .from("ProjectWikiSection")
        .select("id, suppressed")
        .eq("projectId", projectId)
        .eq("sectionKey", sectionKey)
        .maybeSingle();
      if (!section) return { ok: false, error: "Seção não encontrada" };
      const suppressed = parseSuppressed(section.suppressed).filter(
        (s) => s.bulletHash !== bulletHash,
      );
      const { error } = await supabase
        .from("ProjectWikiSection")
        .update({ suppressed: suppressed as never, updatedAt: new Date().toISOString() })
        .eq("id", section.id);
      if (error) return { ok: false, error: error.message };
      return { ok: true, suppressed };
    },
  });
}

export function createRecomposeWikiTool(projectId: string) {
  return tool({
    description:
      "Regenera a Wiki (Objetivos + Highlights) aplicando a ênfase vigente. Use depois de set_wiki_emphasis. Roda grounded — bullets continuam ancorados em fontes. Devolve o que mudou por seção.",
    inputSchema: z.object({}),
    execute: async () => {
      // Dispara o composer no app (monorepo) via HTTP — o daemon não tem o
      // composer (isso é o B2). ZORDON_URL aponta pro app; CRON_SECRET autentica
      // o worker interno (mesmo que /wiki/compose usa).
      const secret = process.env.CRON_SECRET;
      if (!secret) {
        return {
          ok: false,
          error:
            "CRON_SECRET ausente no ambiente — recompose não pôde autenticar no worker do app. Configure CRON_SECRET no .env do daemon.",
        };
      }
      const base = process.env.ZORDON_URL ?? "http://localhost:3000";
      const supabase = db();
      const { data: job, error } = await supabase
        .from("WikiJob")
        .insert({ projectId, trigger: "manual" })
        .select("id")
        .single();
      if (error || !job) {
        return { ok: false, error: error?.message ?? "Falha ao criar WikiJob" };
      }
      try {
        const res = await fetch(`${base}/api/internal/wiki-composer`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-cron-secret": secret },
          body: JSON.stringify({ projectId, jobId: job.id, trigger: "manual" }),
        });
        if (!res.ok) {
          return { ok: false, error: `worker do composer respondeu ${res.status}` };
        }
        const result = (await res.json()) as {
          sections?: Record<string, string>;
          errors?: string[];
        };
        return { ok: true, sections: result.sections ?? {}, errors: result.errors ?? [] };
      } catch (e) {
        return {
          ok: false,
          error: `não alcancei o worker do composer em ${base}: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    },
  });
}
