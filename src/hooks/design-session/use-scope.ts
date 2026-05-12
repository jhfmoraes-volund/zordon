"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { useDesignSessionRealtime } from "@/hooks/use-design-session-realtime";

export type ScopeItem = { id: string; text: string };
export type ScopeBucket = "inScope" | "outOfScope" | "does" | "doesNot";

export type ScopeState = Record<ScopeBucket, ScopeItem[]>;

const EMPTY: ScopeState = {
  inScope: [],
  outOfScope: [],
  does: [],
  doesNot: [],
};

function base(sessionId: string) {
  return `/api/design-sessions/${sessionId}/scope`;
}

export function useScope(sessionId: string) {
  const [value, setValue] = useState<ScopeState>(EMPTY);
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
          scope: Partial<ScopeState> | null;
        };
        if (!cancelled) {
          const row = json.scope ?? {};
          setValue({
            inScope: row.inScope ?? [],
            outOfScope: row.outOfScope ?? [],
            does: row.does ?? [],
            doesNot: row.doesNot ?? [],
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
      if (entity !== "scope" || event === "DELETE") return;
      const incoming: ScopeState = {
        inScope: (row.inScope as ScopeItem[]) ?? [],
        outOfScope: (row.outOfScope as ScopeItem[]) ?? [],
        does: (row.does as ScopeItem[]) ?? [],
        doesNot: (row.doesNot as ScopeItem[]) ?? [],
      };
      const cur = valueRef.current;
      if (JSON.stringify(cur) === JSON.stringify(incoming)) return;
      setValue(incoming);
    },
    { entities: ["scope"] },
  );

  const persistNow = useCallback(async () => {
    try {
      await fetchOrThrow(base(sessionId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(valueRef.current),
      });
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar escopo" });
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

  const addItem = useCallback(
    (bucket: ScopeBucket, item: ScopeItem) => {
      setValue((prev) => ({ ...prev, [bucket]: [...prev[bucket], item] }));
      scheduleSave(true);
    },
    [scheduleSave],
  );

  const updateItem = useCallback(
    (bucket: ScopeBucket, itemId: string, text: string) => {
      setValue((prev) => ({
        ...prev,
        [bucket]: prev[bucket].map((it) =>
          it.id === itemId ? { ...it, text } : it,
        ),
      }));
      scheduleSave();
    },
    [scheduleSave],
  );

  const deleteItem = useCallback(
    (bucket: ScopeBucket, itemId: string) => {
      setValue((prev) => ({
        ...prev,
        [bucket]: prev[bucket].filter((it) => it.id !== itemId),
      }));
      scheduleSave(true);
    },
    [scheduleSave],
  );

  return { value, loaded, addItem, updateItem, deleteItem };
}
