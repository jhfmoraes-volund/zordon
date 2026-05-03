"use client";

import { useCallback, useEffect, useRef } from "react";

type Pending = {
  fn: () => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Coalesce repeated triggers per logical "field" key into one call after
 * `delayMs` of quiet. Re-triggering the same key cancels the previous pending
 * call and reschedules with the latest function.
 *
 * On unmount, all pending calls are flushed synchronously so we never lose
 * a save (e.g. user edits then closes the sheet).
 */
export function useFieldDebounce(delayMs: number) {
  const pendingRef = useRef<Map<string, Pending>>(new Map());

  const schedule = useCallback(
    (key: string, fn: () => void) => {
      const map = pendingRef.current;
      const prev = map.get(key);
      if (prev) clearTimeout(prev.timer);
      const timer = setTimeout(() => {
        map.delete(key);
        fn();
      }, delayMs);
      map.set(key, { fn, timer });
    },
    [delayMs],
  );

  const flush = useCallback((key?: string) => {
    const map = pendingRef.current;
    if (key !== undefined) {
      const p = map.get(key);
      if (!p) return;
      clearTimeout(p.timer);
      map.delete(key);
      p.fn();
      return;
    }
    for (const [, p] of map) {
      clearTimeout(p.timer);
      p.fn();
    }
    map.clear();
  }, []);

  useEffect(() => {
    return () => {
      flush();
    };
  }, [flush]);

  return { schedule, flush };
}
