"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Sparkles } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetBody,
} from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { useIsGuest } from "@/hooks/use-is-guest";
import { fetchOrThrow } from "@/lib/optimistic/toast";
import type { WikiMetrics } from "@/lib/dal/wiki-metrics";
import { WikiHero } from "./wiki-hero";
import { WikiIdentity, type WikiObjective } from "./wiki-identity";
import { WikiActivity } from "./wiki-activity";
import {
  WikiNarrativeSection,
  type WikiSectionView,
} from "./wiki-narrative-section";

/**
 * Wiki executiva auto-gerada (PRD project-wiki + WER-006). Leitura executiva
 * determinística no topo (SQL live): Identidade (cliente/projeto/objetivo/
 * cronograma) + Pulso + Atividade recente. Abaixo, narrativa cacheada do
 * composer (objectives/highlights) + equipe + footer "Gerar Wiki" (202 + poll
 * em WikiJob). Sem edição manual — a única intervenção humana é suprimir
 * bullet (D2).
 */

type Props = {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProjectWikiSheet({
  projectId,
  projectName,
  open,
  onOpenChange,
}: Props) {
  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="lg">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Wiki — {projectName}</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>
        <ResponsiveSheetBody>
          {/* Remount a cada abertura: estado fresco + refetch sem cache stale */}
          {open && <WikiSheetContent projectId={projectId} />}
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

const SECTION_HINTS: Record<string, string> = {
  objectives:
    "Sem objetivos gerados — aprove uma DS de Inception ou importe documentos pro contexto e clique em Gerar Wiki.",
  highlights: "Sem highlights no período.",
};

const SECTION_TITLES: Record<string, string> = {
  objectives: "Objetivos",
  highlights: "Highlights da semana",
};

// 'decisions' saiu (WER-006): decisões viram evento no log de Atividade.
const SECTION_KEYS = ["objectives", "highlights"] as const;

/** Label legível da fonte de um bullet (espelha SOURCE_TYPE_LABELS). */
const SOURCE_LABELS: Record<string, string> = {
  meeting: "meeting",
  design_session: "DS",
  task: "task",
  sprint: "sprint",
  pm_review: "PM review",
  context_source: "doc",
};

function agoLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

function WikiSheetContent({ projectId }: { projectId: string }) {
  const [metrics, setMetrics] = useState<WikiMetrics | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [composing, setComposing] = useState(false);
  const isGuest = useIsGuest();
  const aliveRef = useRef(true);

  const {
    items: sections,
    setCommitted: setSections,
    mutate,
  } = useOptimisticCollection<WikiSectionView>([]);

  const load = useCallback(async () => {
    try {
      const [metricsRes, sectionsRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/wiki/metrics`),
        fetch(`/api/projects/${projectId}/wiki`),
      ]);
      if (!metricsRes.ok || !sectionsRes.ok) throw new Error("load failed");
      const metricsBody = (await metricsRes.json()) as WikiMetrics;
      const sectionsBody = (await sectionsRes.json()) as {
        sections: WikiSectionView[];
      };
      if (!aliveRef.current) return;
      setMetrics(metricsBody);
      setSections(sectionsBody.sections ?? []);
    } catch {
      if (aliveRef.current) toast.error("Erro ao carregar wiki");
    } finally {
      if (aliveRef.current) setLoaded(true);
    }
  }, [projectId, setSections]);

  useEffect(() => {
    aliveRef.current = true;
    load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  // ── Gerar Wiki: 202 + poll do WikiJob até done|failed ─────
  const compose = useCallback(async () => {
    if (composing) return;
    setComposing(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/wiki/compose`, {
        method: "POST",
      });
      if (res.status === 403) {
        toast.error("Sem permissão pra gerar a wiki deste projeto");
        return;
      }
      if (res.status !== 202) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast.error(body?.error ?? "Falha ao iniciar a geração");
        return;
      }
      const { jobId } = (await res.json()) as { jobId: string };

      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline && aliveRef.current) {
        await new Promise((r) => setTimeout(r, 1500));
        const poll = await fetch(
          `/api/projects/${projectId}/wiki/jobs/${jobId}`
        );
        if (!poll.ok) continue;
        const job = (await poll.json()) as { status: string; error?: string };
        if (job.status === "done") {
          await load();
          toast.success("Wiki atualizada");
          if (job.error) toast.warning(`Seções com aviso: ${job.error}`);
          return;
        }
        if (job.status === "failed") {
          toast.error(job.error ?? "Geração falhou");
          return;
        }
      }
      if (aliveRef.current) toast.error("Geração demorou demais — tente de novo");
    } catch {
      toast.error("Sem conexão — geração não disparada");
    } finally {
      if (aliveRef.current) setComposing(false);
    }
  }, [projectId, composing, load]);

  // ── Suppress otimista (runbook optimistic-updates) ────────
  const suppressBullet = useCallback(
    (section: WikiSectionView, bulletHash: string) => {
      void mutate(
        {
          type: "patch",
          id: section.id,
          patch: {
            suppressed: [
              ...section.suppressed,
              {
                bulletHash,
                suppressedBy: "me",
                suppressedAt: new Date().toISOString(),
              },
            ],
          },
        },
        async (signal) => {
          const res = await fetchOrThrow(
            `/api/projects/${projectId}/wiki/suppress`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sectionKey: section.sectionKey,
                bulletHash,
              }),
              signal,
            }
          );
          return (await res.json()) as {
            suppressed: WikiSectionView["suppressed"];
          };
        },
        {
          errorLabel: "Ocultar bullet",
          reconcile: (prev, result) =>
            prev.map((s) =>
              s.id === section.id ? { ...s, suppressed: result.suppressed } : s
            ),
        }
      );
    },
    [mutate, projectId]
  );

  if (!loaded) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  const sectionByKey = new Map(sections.map((s) => [s.sectionKey, s]));

  // Objetivo do header (D6): vision bullet da seção objectives + sua fonte.
  const objectivesSection = sectionByKey.get("objectives");
  const visionBullet = (
    objectivesSection?.data as { vision?: { text?: string; bulletHash?: string } }
  )?.vision;
  let objective: WikiObjective = null;
  if (visionBullet?.text && visionBullet.bulletHash) {
    const src = objectivesSection?.sources.find(
      (s) => s.bulletHash === visionBullet.bulletHash
    );
    objective = {
      text: visionBullet.text,
      sourceLabel: src
        ? (src.title ?? SOURCE_LABELS[src.sourceType] ?? src.sourceType)
        : null,
      sourceUrl: src?.url ?? null,
    };
  }

  const lastGeneratedAt = sections.reduce<string | null>(
    (max, s) =>
      s.generatedAt && (max === null || s.generatedAt > max)
        ? s.generatedAt
        : max,
    null
  );
  const sourceCount = new Set(
    sections.flatMap((s) => s.sources.map((src) => src.sourceId))
  ).size;

  return (
    <div className="space-y-3">
      {metrics && (
        <WikiIdentity
          identity={metrics.identity}
          sprints={metrics.sprints}
          objective={objective}
        />
      )}

      {metrics && <WikiHero hero={metrics.hero} />}

      {metrics && <WikiActivity activity={metrics.activity} />}

      {composing ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        SECTION_KEYS.map((key) => {
          const section =
            sectionByKey.get(key) ??
            ({
              id: key,
              sectionKey: key,
              title: SECTION_TITLES[key],
              data: {},
              suppressed: [],
              generatedAt: null,
              generatedBy: null,
              sources: [],
            } satisfies WikiSectionView);
          return (
            <WikiNarrativeSection
              key={key}
              section={{ ...section, title: SECTION_TITLES[key] }}
              emptyHint={SECTION_HINTS[key]}
              canSuppress={!isGuest}
              onSuppress={(bulletHash) => suppressBullet(section, bulletHash)}
            />
          );
        })
      )}

      {metrics && metrics.team.length > 0 && (
        <section className="surface space-y-2 px-4 py-3">
          <h3 className="text-sm font-semibold">Equipe</h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {metrics.team.map((m) => (
              <li key={m.memberId} className="text-sm">
                {m.name}
                <span className="text-xs text-muted-foreground">
                  {" "}
                  · {m.position ?? m.role}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-xs text-muted-foreground">
          {lastGeneratedAt
            ? `gerada ${agoLabel(lastGeneratedAt)} · ${sourceCount} fonte${sourceCount === 1 ? "" : "s"}`
            : "ainda não gerada"}
        </p>
        {!isGuest && (
          <Button
            variant="outline"
            size="sm"
            onClick={compose}
            disabled={composing}
          >
            {composing ? (
              <RefreshCw className={cn("h-4 w-4", "animate-spin")} />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {composing ? "Gerando..." : lastGeneratedAt ? "Atualizar Wiki" : "Gerar Wiki"}
          </Button>
        )}
      </div>
    </div>
  );
}
