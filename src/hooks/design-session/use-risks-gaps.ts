"use client";

import { useCallback, useEffect, useState } from "react";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { fetchOrThrow } from "@/lib/optimistic/toast";

type Category = "business" | "technical";
type Severity = "high" | "medium" | "low";

export type RiskRow = {
  id: string;
  sessionId: string;
  text: string;
  category: Category;
  severity: Severity;
  relatedFeature: string | null;
  mitigation: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type GapRow = {
  id: string;
  sessionId: string;
  text: string;
  category: Category | null;
  severity: Severity | null;
  relatedFeature: string | null;
  mitigation: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

function risksBase(sessionId: string) {
  return `/api/design-sessions/${sessionId}/risks`;
}

function gapsBase(sessionId: string) {
  return `/api/design-sessions/${sessionId}/gaps`;
}

export function useRisksGaps(sessionId: string) {
  const risks = useOptimisticCollection<RiskRow>([]);
  const gaps = useOptimisticCollection<GapRow>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rRes, gRes] = await Promise.all([
          fetchOrThrow(risksBase(sessionId)),
          fetchOrThrow(gapsBase(sessionId)),
        ]);
        const rJson = (await rRes.json()) as { risks: RiskRow[] };
        const gJson = (await gRes.json()) as { gaps: GapRow[] };
        if (!cancelled) {
          risks.setCommitted(rJson.risks ?? []);
          gaps.setCommitted(gJson.gaps ?? []);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const addRisk = useCallback(
    async (initial: Partial<RiskRow>) => {
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      const optimisticEntity: RiskRow = {
        id: tempId,
        sessionId,
        text: initial.text ?? "",
        category: (initial.category as Category) ?? "business",
        severity: (initial.severity as Severity) ?? "medium",
        relatedFeature: initial.relatedFeature ?? null,
        mitigation: initial.mitigation ?? null,
        orderIndex: risks.items.length,
        createdAt: now,
        updatedAt: now,
      };
      await risks.mutate(
        { type: "create", entity: optimisticEntity },
        async () => {
          const res = await fetchOrThrow(risksBase(sessionId), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: optimisticEntity.text,
              category: optimisticEntity.category,
              severity: optimisticEntity.severity,
              relatedFeature: optimisticEntity.relatedFeature,
              mitigation: optimisticEntity.mitigation,
            }),
          });
          return ((await res.json()) as { risk: RiskRow }).risk;
        },
        {
          errorLabel: "Falha ao criar risco",
          retry: false,
          reconcile: (prev, result) => {
            const real = result as RiskRow;
            if (prev.some((r) => r.id === tempId)) {
              return prev.map((r) => (r.id === tempId ? real : r));
            }
            if (prev.some((r) => r.id === real.id)) return prev;
            return [...prev, real];
          },
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, risks.items.length],
  );

  const updateRisk = useCallback(
    async (riskId: string, patch: Partial<RiskRow>) => {
      await risks.mutate(
        { type: "patch", id: riskId, patch },
        async () => {
          const res = await fetchOrThrow(`${risksBase(sessionId)}/${riskId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          return ((await res.json()) as { risk: RiskRow }).risk;
        },
        { errorLabel: "Falha ao salvar risco" },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId],
  );

  const deleteRisk = useCallback(
    async (riskId: string) => {
      await risks.mutate(
        { type: "delete", id: riskId },
        async () => {
          await fetchOrThrow(`${risksBase(sessionId)}/${riskId}`, {
            method: "DELETE",
          });
          return true;
        },
        { errorLabel: "Falha ao remover risco", retry: false },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId],
  );

  const addGap = useCallback(
    async (initial: Partial<GapRow>) => {
      const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      const optimisticEntity: GapRow = {
        id: tempId,
        sessionId,
        text: initial.text ?? "",
        category: initial.category ?? null,
        severity: initial.severity ?? null,
        relatedFeature: initial.relatedFeature ?? null,
        mitigation: initial.mitigation ?? null,
        orderIndex: gaps.items.length,
        createdAt: now,
        updatedAt: now,
      };
      await gaps.mutate(
        { type: "create", entity: optimisticEntity },
        async () => {
          const res = await fetchOrThrow(gapsBase(sessionId), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: optimisticEntity.text,
              category: optimisticEntity.category,
              severity: optimisticEntity.severity,
              relatedFeature: optimisticEntity.relatedFeature,
              mitigation: optimisticEntity.mitigation,
            }),
          });
          return ((await res.json()) as { gap: GapRow }).gap;
        },
        {
          errorLabel: "Falha ao criar gap",
          retry: false,
          reconcile: (prev, result) => {
            const real = result as GapRow;
            if (prev.some((g) => g.id === tempId)) {
              return prev.map((g) => (g.id === tempId ? real : g));
            }
            if (prev.some((g) => g.id === real.id)) return prev;
            return [...prev, real];
          },
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, gaps.items.length],
  );

  const updateGap = useCallback(
    async (gapId: string, patch: Partial<GapRow>) => {
      await gaps.mutate(
        { type: "patch", id: gapId, patch },
        async () => {
          const res = await fetchOrThrow(`${gapsBase(sessionId)}/${gapId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          return ((await res.json()) as { gap: GapRow }).gap;
        },
        { errorLabel: "Falha ao salvar gap" },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId],
  );

  const deleteGap = useCallback(
    async (gapId: string) => {
      await gaps.mutate(
        { type: "delete", id: gapId },
        async () => {
          await fetchOrThrow(`${gapsBase(sessionId)}/${gapId}`, {
            method: "DELETE",
          });
          return true;
        },
        { errorLabel: "Falha ao remover gap", retry: false },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId],
  );

  return {
    risks: risks.items,
    gaps: gaps.items,
    loaded,
    addRisk,
    updateRisk,
    deleteRisk,
    addGap,
    updateGap,
    deleteGap,
  };
}
