"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { useDesignSessionRealtime } from "@/hooks/use-design-session-realtime";

export type ProductVision = {
  problem: string;
  whoSuffers: string;
  consequences: string;
  successVision: string;
  impactMetrics: string;
};

const EMPTY: ProductVision = {
  problem: "",
  whoSuffers: "",
  consequences: "",
  successVision: "",
  impactMetrics: "",
};

function base(sessionId: string) {
  return `/api/design-sessions/${sessionId}/product-vision`;
}

export function useProductVision(sessionId: string) {
  const [value, setValue] = useState<ProductVision>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchOrThrow(base(sessionId));
        const json = (await res.json()) as { productVision: ProductVision | null };
        if (!cancelled) {
          setValue(json.productVision ?? EMPTY);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const persist = useCallback(async () => {
    try {
      await fetchOrThrow(base(sessionId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(valueRef.current),
      });
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar visão de produto" });
    }
  }, [sessionId]);

  useDesignSessionRealtime(
    sessionId,
    (entity, event, row) => {
      if (entity !== "product_vision" || event === "DELETE") return;
      const incoming: ProductVision = {
        problem: (row.problem as string) ?? "",
        whoSuffers: (row.whoSuffers as string) ?? "",
        consequences: (row.consequences as string) ?? "",
        successVision: (row.successVision as string) ?? "",
        impactMetrics: (row.impactMetrics as string) ?? "",
      };
      // Skip if echo — same payload já no client.
      const cur = valueRef.current;
      if (
        cur.problem === incoming.problem &&
        cur.whoSuffers === incoming.whoSuffers &&
        cur.consequences === incoming.consequences &&
        cur.successVision === incoming.successVision &&
        cur.impactMetrics === incoming.impactMetrics
      ) {
        return;
      }
      setValue(incoming);
    },
    { entities: ["product_vision"] },
  );

  const updateField = useCallback(
    <K extends keyof ProductVision>(field: K, fieldValue: ProductVision[K]) => {
      setValue((prev) => ({ ...prev, [field]: fieldValue }));
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void persist();
      }, 500);
    },
    [persist],
  );

  return { value, loaded, updateField };
}
