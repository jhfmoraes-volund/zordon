import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { composeWiki } from "@/lib/wiki/composer";
import {
  EXTERNAL_KINDS,
  refreshExternalSource,
} from "@/lib/context-sources/refresh";

/**
 * POST /api/cron/wiki-daily — tick diário do pipeline da Wiki (runbook D12/D13).
 * Disparada pelo pg_cron (06:00 UTC = 03:00 BRT) via pg_net + Vault.
 *
 * Por projeto elegível (≥1 ContextSource OU driveFolderId, sem job em voo),
 * sequencialmente (é 03:00 — latência não importa, rate limit importa):
 *   1. Refresh: re-resolve fullText dos sources externos com snapshot > 20h.
 *      Erro num source → loga, marca e segue (não derruba o batch).
 *   2. Cria WikiJob (trigger='cron') e chama composeWiki() direto — mesma
 *      instância, sem fetch.
 *
 * 200 { projects, refreshed, composed, failures } · 401 sem x-cron-secret
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const REFRESH_MAX_AGE_MS = 20 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new NextResponse("Server misconfigured: CRON_SECRET missing", {
      status: 500,
    });
  }
  if (req.headers.get("x-cron-secret") !== secret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const supabase = db();
  const failures: string[] = [];
  let refreshed = 0;
  let composed = 0;

  // ── Projetos elegíveis ────────────────────────────────────
  const [projectsRes, sourcesRes, jobsRes] = await Promise.all([
    supabase.from("Project").select("id, name, driveFolderId"),
    supabase
      .from("ContextSource")
      .select("id, projectId, kind, capturedAt, createdAt")
      .not("projectId", "is", null),
    supabase.from("WikiJob").select("projectId").in("status", ["pending", "running"]),
  ]);
  if (projectsRes.error || sourcesRes.error || jobsRes.error) {
    const message =
      projectsRes.error?.message ??
      sourcesRes.error?.message ??
      jobsRes.error?.message ??
      "query falhou";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const sources = sourcesRes.data ?? [];
  const projectsWithSources = new Set(sources.map((s) => s.projectId));
  const projectsWithJobInFlight = new Set(
    (jobsRes.data ?? []).map((j) => j.projectId)
  );
  const eligible = (projectsRes.data ?? []).filter(
    (p) =>
      (p.driveFolderId !== null || projectsWithSources.has(p.id)) &&
      !projectsWithJobInFlight.has(p.id)
  );

  const staleBefore = Date.now() - REFRESH_MAX_AGE_MS;

  for (const project of eligible) {
    // ── 1. Refresh dos sources externos > 20h (D13) ─────────
    const stale = sources.filter(
      (s) =>
        s.projectId === project.id &&
        (EXTERNAL_KINDS as readonly string[]).includes(s.kind) &&
        new Date(s.capturedAt ?? s.createdAt).getTime() < staleBefore
    );
    for (const sourceRow of stale) {
      try {
        const { data: full, error } = await supabase
          .from("ContextSource")
          .select("*")
          .eq("id", sourceRow.id)
          .single();
        if (error || !full) throw new Error(error?.message ?? "source sumiu");
        await refreshExternalSource(supabase, full);
        refreshed += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : "refresh falhou";
        console.warn(
          `[wiki-daily] refresh falhou (source ${sourceRow.id}, projeto ${project.name}): ${message}`
        );
        failures.push(`refresh:${sourceRow.id}: ${message}`);
      }
    }

    // ── 2. Compose direto (sem fetch — mesma instância) ─────
    try {
      const { data: job, error } = await supabase
        .from("WikiJob")
        .insert({ projectId: project.id, trigger: "cron" })
        .select("id")
        .single();
      if (error || !job) throw new Error(error?.message ?? "WikiJob falhou");
      const result = await composeWiki(project.id, job.id, "cron");
      composed += 1;
      if (result.errors.length > 0) {
        failures.push(`compose:${project.id}: ${result.errors.join("; ")}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "compose falhou";
      console.error(
        `[wiki-daily] compose falhou (projeto ${project.name}): ${message}`
      );
      failures.push(`compose:${project.id}: ${message}`);
    }
  }

  return NextResponse.json({
    projects: eligible.length,
    refreshed,
    composed,
    failures,
  });
}
