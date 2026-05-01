"use client";

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import {
  reconcileById,
  removeById,
  removeManyById,
  patchById,
  patchManyById,
  replaceTempId,
} from "@/lib/optimistic/reconcile";
import { showErrorToast, withServerRetry } from "@/lib/optimistic/toast";

export type WithId = { id: string; updatedAt?: string | null };

export type BaseMutation<T extends WithId> =
  | { type: "patch"; id: string; patch: Partial<T> }
  | { type: "create"; entity: T }
  | { type: "delete"; id: string }
  | { type: "bulkPatch"; ids: string[]; patch: Partial<T> }
  | { type: "bulkDelete"; ids: string[] }
  | { type: "external_update"; entity: T };

export type AnyMutation<T extends WithId, X> = BaseMutation<T> | X;

export function baseReducer<T extends WithId>(
  state: T[],
  m: BaseMutation<T>,
): T[] {
  switch (m.type) {
    case "patch":
      return patchById(state, m.id, m.patch);
    case "create":
      return state.some((x) => x.id === m.entity.id)
        ? state
        : [...state, m.entity];
    case "delete":
      return removeById(state, m.id);
    case "bulkPatch":
      return patchManyById(state, m.ids, m.patch);
    case "bulkDelete":
      return removeManyById(state, m.ids);
    case "external_update":
      return reconcileById(state, m.entity);
  }
}

export function combineReducers<T extends WithId, X>(
  extra: (state: T[], m: X) => T[] | undefined,
): (state: T[], m: AnyMutation<T, X>) => T[] {
  return (state, m) => {
    if ((m as BaseMutation<T>).type in baseReducerTypeMap) {
      return baseReducer(state, m as BaseMutation<T>);
    }
    const result = extra(state, m as X);
    return result ?? state;
  };
}

const baseReducerTypeMap = {
  patch: 1,
  create: 1,
  delete: 1,
  bulkPatch: 1,
  bulkDelete: 1,
  external_update: 1,
} as const;

export type MutateOptions<T extends WithId, X, R> = {
  reconcile?: (prev: T[], result: R) => T[];
  errorLabel: string;
  retry?: boolean;
};

export type Mutate<T extends WithId, X> = <R>(
  mutation: AnyMutation<T, X>,
  persist: (signal: AbortSignal) => Promise<R>,
  options: MutateOptions<T, X, R>,
) => Promise<R | null>;

export type UseOptimisticCollection<T extends WithId, X> = {
  items: T[];
  committed: T[];
  setCommitted: (next: T[] | ((prev: T[]) => T[])) => void;
  mutate: Mutate<T, X>;
  isPending: boolean;
  abortKey: (key: string) => void;
};

type Reducer<T extends WithId, X> = (
  state: T[],
  m: AnyMutation<T, X>,
) => T[];

export function useOptimisticCollection<T extends WithId, X = never>(
  initial: T[],
  reducer: Reducer<T, X> = baseReducer as Reducer<T, X>,
): UseOptimisticCollection<T, X> {
  const [committed, setCommitted] = useState<T[]>(initial);
  const initialRef = useRef(initial);
  useEffect(() => {
    if (initialRef.current !== initial) {
      initialRef.current = initial;
      setCommitted(initial);
    }
  }, [initial]);

  const [optimistic, applyOptimistic] = useOptimistic(committed, reducer);
  const [isPending, startTransition] = useTransition();

  const controllers = useRef(new Map<string, AbortController>());

  const abortKey = useCallback((key: string) => {
    controllers.current.get(key)?.abort();
    controllers.current.delete(key);
  }, []);

  const keyFor = (m: AnyMutation<T, X>): string => {
    const any = m as { type?: string; id?: string; ids?: string[] };
    if (any.type === "bulkPatch" || any.type === "bulkDelete") {
      return `bulk:${any.type}`;
    }
    if (any.id) return `${any.type}:${any.id}`;
    return `m:${any.type ?? "unknown"}`;
  };

  const mutate: Mutate<T, X> = useCallback(
    async (mutation, persist, options) => {
      const key = keyFor(mutation);
      controllers.current.get(key)?.abort();
      const ctrl = new AbortController();
      controllers.current.set(key, ctrl);

      let result: unknown = null;
      let resolved = false;

      await new Promise<void>((resolve) => {
        startTransition(async () => {
          applyOptimistic(mutation);
          try {
            const exec = () => persist(ctrl.signal);
            result = options.retry === false
              ? await exec()
              : await withServerRetry(exec);
            resolved = true;
            if (options.reconcile) {
              setCommitted((prev) =>
                options.reconcile!(prev, result as never),
              );
            } else {
              setCommitted((prev) => reducer(prev, mutation));
            }
          } catch (e) {
            if (
              e instanceof DOMException &&
              e.name === "AbortError"
            ) {
              resolve();
              return;
            }
            showErrorToast(e, {
              label: options.errorLabel,
              onRetry: () => {
                void mutate(mutation, persist, options);
              },
            });
          } finally {
            if (controllers.current.get(key) === ctrl) {
              controllers.current.delete(key);
            }
            resolve();
          }
        });
      });

      return resolved ? (result as never) : null;
    },
    [applyOptimistic, reducer],
  );

  const setCommittedExternal = useCallback(
    (next: T[] | ((prev: T[]) => T[])) => {
      setCommitted(next);
    },
    [],
  );

  return {
    items: optimistic,
    committed,
    setCommitted: setCommittedExternal,
    mutate,
    isPending,
    abortKey,
  };
}
