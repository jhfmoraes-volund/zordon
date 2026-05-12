"use client";

/**
 * Helper interno: pluga useDesignSessionRealtime numa collection (useOptimisticCollection)
 * pra refletir mudanças vindas de outros clients (Vitor, UI de outras tabs).
 *
 * Usado pelos hooks `usePersonas`, `useBrainstormFeatures`, etc.
 * Plano: docs/vitor-normalization-plan-v2.md §3.3.
 */

import { useEffect } from "react";
import { useDesignSessionRealtime, type DSEntity } from "@/hooks/use-design-session-realtime";
import type {
  UseOptimisticCollection,
  WithId,
} from "@/hooks/use-optimistic-collection";

/**
 * Recebe a collection do hook e o entity name; refresh em INSERT/UPDATE/DELETE.
 *
 * fetchFresh: callback opcional que re-busca o estado canônico após o evento.
 * Pra entidades 1:N use é mais barato aplicar diretamente (external_update / delete).
 * Pra entidades 1:1 (product_vision, scope, tech_specs) o melhor é refetch.
 */
export function useDSCollectionRealtime<T extends WithId>(
  sessionId: string | null | undefined,
  entity: DSEntity,
  collection: UseOptimisticCollection<T, never>,
  options: {
    enabled?: boolean;
    /** map row do realtime payload pro shape do collection (default identity) */
    mapRow?: (row: Record<string, unknown>) => T;
  } = {},
) {
  const enabled = options.enabled ?? true;
  const mapRow = options.mapRow ?? ((row: Record<string, unknown>) => row as unknown as T);
  const { setCommitted } = collection;

  useEffect(() => {
    // no-op — keeps types happy when realtime disabled
  }, [setCommitted]);

  useDesignSessionRealtime(
    sessionId,
    (e, event, row) => {
      if (e !== entity) return;
      if (event === "DELETE") {
        const id = row.id as string | undefined;
        if (!id) return;
        setCommitted((prev) => prev.filter((x) => x.id !== id));
        return;
      }
      // INSERT or UPDATE
      const mapped = mapRow(row);
      if (!mapped?.id) return;
      setCommitted((prev) => {
        const idx = prev.findIndex((x) => x.id === mapped.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = mapped;
          return next;
        }
        return [...prev, mapped];
      });
    },
    { entities: [entity], enabled },
  );
}
