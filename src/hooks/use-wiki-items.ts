"use client";

import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";

type WikiSection = {
  id: string;
  projectId: string;
  sectionKey: string;
  title: string;
  data: unknown;
  order: number;
};

export function useWikiItems<T>(
  section: WikiSection,
  onUpdate: (data: T[]) => Promise<void>,
  opts?: { debounceMs?: number }
) {
  const debounceMs = opts?.debounceMs ?? 500;

  const [items, setItems] = useState<T[]>(() =>
    (Array.isArray(section.data) ? section.data : []) as T[]
  );
  const [adding, setAdding] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(
    async (updated: T[]) => {
      try {
        await onUpdate(updated);
        toast.success("Salvo", { id: "wiki-save" });
      } catch {
        toast.error("Erro ao salvar", { id: "wiki-save" });
      }
    },
    [onUpdate]
  );

  const save = useCallback(
    (updated: T[]) => {
      setItems(updated);
      persist(updated);
    },
    [persist]
  );

  const debouncedPersist = useCallback(
    (updated: T[]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => persist(updated), debounceMs);
    },
    [persist, debounceMs]
  );

  const add = useCallback(
    (item: T) => {
      const updated = [...items, item];
      save(updated);
    },
    [items, save]
  );

  const remove = useCallback(
    (index: number) => {
      const updated = items.filter((_, i) => i !== index);
      save(updated);
    },
    [items, save]
  );

  const updateItem = useCallback(
    (index: number, partial: Partial<T>) => {
      const updated = items.map((item, i) =>
        i === index ? { ...item, ...partial } : item
      );
      setItems(updated);
      debouncedPersist(updated);
    },
    [items, debouncedPersist]
  );

  const replaceItem = useCallback(
    (index: number, item: T) => {
      const updated = items.map((it, i) => (i === index ? item : it));
      save(updated);
    },
    [items, save]
  );

  return {
    items,
    setItems,
    save,
    add,
    remove,
    updateItem,
    replaceItem,
    adding,
    setAdding,
  };
}
