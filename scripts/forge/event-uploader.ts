/**
 * Forge Event Uploader (daemon-side)
 *
 * Lê o events.jsonl de um run em $FORGE_HOME/runs/<runId>/events.jsonl e faz
 * batch upload pro ForgeEvent table no Supabase. Polling-based pra evitar
 * dependência de chokidar/watch — barato pra um arquivo append-only.
 *
 * Usage:
 *   const stop = startUploaderForRun(runId);
 *   // ... worker roda ...
 *   await stop(); // flush final + para o poller
 *
 * Idempotente: usa UNIQUE constraint (runId, seq) — duplicate inserts são
 * detectados e ignorados.
 */
import { existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../../src/lib/db";
import type { Json } from "../../src/lib/supabase/database.types";
import { getRunPath } from "../../src/lib/forge/paths";

type EventLine = {
  runId: string;
  taskId?: string;
  seq?: number;
  ts?: string;
  kind?: string;
  payload?: Record<string, unknown>;
};

const POLL_INTERVAL_MS = 1000;

export function startUploaderForRun(runId: string): {
  stop: () => Promise<void>;
} {
  const eventsPath = resolve(getRunPath(runId), "events.jsonl");
  let position = 0;
  let buffer = "";
  let stopping = false;
  let inFlight = false;

  // Track seqs já uploadados nesse processo pra reduzir tentativas duplicadas
  // (DB tem UNIQUE então é seguro, mas poupa round-trips).
  const seenSeqs = new Set<number>();

  async function flush() {
    if (inFlight) return;
    if (!existsSync(eventsPath)) return;
    inFlight = true;
    try {
      const stat = statSync(eventsPath);
      if (stat.size <= position) return;

      const fd = openSync(eventsPath, "r");
      const newSize = stat.size - position;
      const chunk = Buffer.alloc(newSize);
      readSync(fd, chunk, 0, newSize, position);
      closeSync(fd);
      position = stat.size;
      buffer += chunk.toString("utf-8");

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // mantém última linha possivelmente incompleta

      const supabase = db();
      let uploaded = 0;
      let skipped = 0;
      let failed = 0;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let ev: EventLine;
        try {
          ev = JSON.parse(trimmed) as EventLine;
        } catch {
          continue;
        }

        if (!ev.runId || ev.seq === undefined) continue;

        // Eventos do orchestrator vêm com runId=<autorunId>=<our runId>.
        // Eventos do worker vêm com runId=<storyRunId> diferente. Filtra:
        // só queremos eventos cujo runId === nosso runId.
        if (ev.runId !== runId) {
          // mas eventos de stories filhas ainda apontam pra esse run via
          // taskId/storyId; o worker emite com runId=storyRunId próprio.
          // Vamos só dropar — eles ainda chegam ao DB pelo upload da story
          // run quando a story rodar isolada (não no nosso modelo banco).
          // No modelo banco atual (1 PRD = 1 story holística), o exec-story
          // herda o autorunId via env. Vamos confiar nisso e dropar mismatches.
          continue;
        }

        if (seenSeqs.has(ev.seq)) continue;

        const { error } = await supabase.from("ForgeEvent").insert({
          runId: ev.runId,
          seq: ev.seq,
          taskId: ev.taskId ?? null,
          ts: ev.ts ?? new Date().toISOString(),
          kind: ev.kind ?? "unknown",
          payload: (ev.payload ?? {}) as Json,
        });

        if (error) {
          // 23505 = unique violation = já inserido (idempotência)
          if (error.code === "23505") {
            seenSeqs.add(ev.seq);
            skipped++;
            continue;
          }
          failed++;
          console.error(
            `[uploader/${runId.slice(0, 8)}] insert seq=${ev.seq} failed:`,
            error.message,
          );
          continue;
        }
        seenSeqs.add(ev.seq);
        uploaded++;
      }

      if (uploaded > 0 || failed > 0) {
        console.log(
          `[uploader/${runId.slice(0, 8)}] +${uploaded} uploaded · ${skipped} dup · ${failed} fail`,
        );
      }
    } finally {
      inFlight = false;
    }
  }

  const poller = setInterval(() => {
    if (stopping) return;
    void flush();
  }, POLL_INTERVAL_MS);

  return {
    stop: async () => {
      stopping = true;
      clearInterval(poller);
      // Flush final pra não perder os últimos eventos antes do close
      await flush();
      // Mais uma flush após pequeno delay pra capturar writes finais do worker
      await new Promise((r) => setTimeout(r, 300));
      await flush();
    },
  };
}
