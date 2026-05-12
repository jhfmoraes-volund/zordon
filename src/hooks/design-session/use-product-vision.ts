"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";

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
