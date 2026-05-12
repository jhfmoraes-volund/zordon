"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { useDesignSessionRealtime } from "@/hooks/use-design-session-realtime";

export type TechSpecItem = { id: string; text: string };

export type TechnicalSpecs = {
  stack: string;
  performance: string;
  integrations: TechSpecItem[];
  rules: TechSpecItem[];
};

const EMPTY: TechnicalSpecs = {
  stack: "",
  performance: "",
  integrations: [],
  rules: [],
};

function base(sessionId: string) {
  return `/api/design-sessions/${sessionId}/technical-specs`;
}

export function useTechnicalSpecs(sessionId: string) {
  const [value, setValue] = useState<TechnicalSpecs>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchOrThrow(base(sessionId));
        const json = (await res.json()) as {
          technicalSpecs: Partial<TechnicalSpecs> | null;
        };
        if (!cancelled) {
          const row = json.technicalSpecs ?? {};
          setValue({
            stack: row.stack ?? "",
            performance: row.performance ?? "",
            integrations: row.integrations ?? [],
            rules: row.rules ?? [],
          });
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

  useDesignSessionRealtime(
    sessionId,
    (entity, event, row) => {
      if (entity !== "tech_specs" || event === "DELETE") return;
      const incoming: TechnicalSpecs = {
        stack: (row.stack as string) ?? "",
        performance: (row.performance as string) ?? "",
        integrations: (row.integrations as TechSpecItem[]) ?? [],
        rules: (row.rules as TechSpecItem[]) ?? [],
      };
      const cur = valueRef.current;
      if (JSON.stringify(cur) === JSON.stringify(incoming)) return;
      setValue(incoming);
    },
    { entities: ["tech_specs"] },
  );

  const persistNow = useCallback(async () => {
    try {
      await fetchOrThrow(base(sessionId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(valueRef.current),
      });
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar specs técnicas" });
    }
  }, [sessionId]);

  const scheduleSave = useCallback(
    (immediate = false) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (immediate) {
        void persistNow();
        return;
      }
      debounceRef.current = setTimeout(() => {
        void persistNow();
      }, 500);
    },
    [persistNow],
  );

  const updateField = useCallback(
    <K extends keyof TechnicalSpecs>(field: K, fieldValue: TechnicalSpecs[K]) => {
      setValue((prev) => ({ ...prev, [field]: fieldValue }));
      scheduleSave();
    },
    [scheduleSave],
  );

  const addItem = useCallback(
    (key: "integrations" | "rules", item: TechSpecItem) => {
      setValue((prev) => ({ ...prev, [key]: [...prev[key], item] }));
      scheduleSave(true);
    },
    [scheduleSave],
  );

  const updateItem = useCallback(
    (key: "integrations" | "rules", itemId: string, text: string) => {
      setValue((prev) => ({
        ...prev,
        [key]: prev[key].map((it) => (it.id === itemId ? { ...it, text } : it)),
      }));
      scheduleSave();
    },
    [scheduleSave],
  );

  const deleteItem = useCallback(
    (key: "integrations" | "rules", itemId: string) => {
      setValue((prev) => ({
        ...prev,
        [key]: prev[key].filter((it) => it.id !== itemId),
      }));
      scheduleSave(true);
    },
    [scheduleSave],
  );

  return { value, loaded, updateField, addItem, updateItem, deleteItem };
}
