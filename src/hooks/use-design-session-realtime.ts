"use client";

/**
 * useDesignSessionRealtime — subscribe Postgres realtime nas 9 tabelas DS.
 *
 * UI pluga via `onChange(entity, event, row)` no seu `useOptimisticCollection`
 * (dispatch `external_update` em INSERT/UPDATE, `delete` em DELETE).
 *
 * Plano: docs/vitor-normalization-plan-v2.md §3.3.
 * Padrão: src/hooks/use-notifications.ts (realtime channel + filter por session).
 */

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

export type DSEntity =
  | "product_vision"
  | "scope"
  | "persona"
  | "brainstorm"
  | "priority"
  | "risk"
  | "gap"
  | "tech_specs"
  | "hypothesis";

export type DSRealtimeEvent = "INSERT" | "UPDATE" | "DELETE";

const ENTITY_TABLE: Record<DSEntity, string> = {
  product_vision: "DesignSessionProductVision",
  scope: "DesignSessionScope",
  persona: "DesignSessionPersona",
  brainstorm: "DesignSessionBrainstormFeature",
  priority: "DesignSessionPriorityItem",
  risk: "DesignSessionRisk",
  gap: "DesignSessionGap",
  tech_specs: "DesignSessionTechnicalSpecs",
  hypothesis: "DesignSessionHypothesis",
};

type RowPayload = Record<string, unknown>;

export type DSChangeHandler = (
  entity: DSEntity,
  event: DSRealtimeEvent,
  row: RowPayload,
) => void;

interface Options {
  entities?: DSEntity[];
  enabled?: boolean;
}

/**
 * Listener única pra todas (ou um subset das) 9 tabelas filtradas por sessionId.
 * Re-subscribe se sessionId/entities mudam. Cleanup na unmount.
 */
export function useDesignSessionRealtime(
  sessionId: string | null | undefined,
  onChange: DSChangeHandler,
  options: Options = {},
) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const entities = options.entities ?? (Object.keys(ENTITY_TABLE) as DSEntity[]);
  const enabled = options.enabled ?? true;
  const entitiesKey = entities.slice().sort().join(",");

  useEffect(() => {
    if (!sessionId || !enabled) return;

    const supabase = supabaseRef.current ?? createClient();
    supabaseRef.current = supabase;

    let channel = supabase.channel(`ds:${sessionId}:${entitiesKey}`);

    for (const entity of entities) {
      const table = ENTITY_TABLE[entity];
      channel = channel.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table,
          filter: `sessionId=eq.${sessionId}`,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const event = payload.eventType as DSRealtimeEvent;
          const row = (payload.new ?? payload.old) as RowPayload;
          if (!row) return;
          onChangeRef.current(entity, event, row);
        },
      );
    }

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sessionId, entitiesKey, enabled, entities]);
}
