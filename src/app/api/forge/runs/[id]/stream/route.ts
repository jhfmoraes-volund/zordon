import { existsSync, watch as fsWatch } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { FSWatcher } from "node:fs";

export const dynamic = "force-dynamic";

/**
 * SSE stream of events.jsonl for a given runId.
 * Tails the file: backfills existing lines, then watches for appends.
 * Closes when client disconnects or after 'done' event is observed.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: runId } = await params;

  // FORGE_HOME default: ~/.volund-forge (daemon escreve aqui).
  // Fallback legacy: <repo>/.forge/<runId>/events.jsonl (modo Ralph).
  const forgeHome =
    process.env.FORGE_HOME?.trim() || resolve(homedir(), ".volund-forge");
  const primaryPath = resolve(forgeHome, "runs", runId, "events.jsonl");
  const legacyPath = resolve(process.cwd(), ".forge", runId, "events.jsonl");
  const eventsPath = existsSync(primaryPath) ? primaryPath : legacyPath;

  const encoder = new TextEncoder();

  const cleanupRef: { current: (() => void) | null } = { current: null };

  const stream = new ReadableStream({
    async start(controller) {
      let position = 0;
      let buffer = "";
      let watcher: FSWatcher | null = null;
      let closed = false;

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };

      const send = (event: unknown) => {
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const sendKeepalive = () => {
        safeEnqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
      };

      const close = () => {
        if (closed) return;
        closed = true;
        watcher?.close();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const drain = async () => {
        if (!existsSync(eventsPath)) return;
        const fh = await open(eventsPath, "r");
        try {
          const stat = await fh.stat();
          if (stat.size <= position) return;
          const chunk = Buffer.alloc(stat.size - position);
          await fh.read(chunk, 0, chunk.length, position);
          position = stat.size;
          buffer += chunk.toString("utf-8");
          let nl;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            try {
              const event = JSON.parse(line);
              send(event);
              if (event.kind === "done") {
                // Give the client a beat to render, then close.
                setTimeout(close, 200);
              }
            } catch (err) {
              send({ kind: "parse_error", line, message: String(err) });
            }
          }
        } finally {
          await fh.close();
        }
      };

      // Initial signal so the client knows the stream is open even if no events yet.
      send({ kind: "stream_open", runId, ts: new Date().toISOString() });

      // Backfill anything already on disk.
      await drain();

      // Watch for appends. If file doesn't exist yet, poll its dir.
      const tryWatch = () => {
        if (closed || !existsSync(eventsPath)) {
          setTimeout(tryWatch, 200);
          return;
        }
        watcher = fsWatch(eventsPath, { persistent: false }, () => {
          drain().catch((err) => send({ kind: "watch_error", message: String(err) }));
        });
      };
      tryWatch();

      // Keepalive every 15s to prevent intermediate proxies from closing.
      const keepaliveInterval = setInterval(sendKeepalive, 15000);

      // Hard timeout 5min for the spike.
      const hardStop = setTimeout(() => {
        send({ kind: "stream_timeout", afterMs: 5 * 60_000 });
        close();
      }, 5 * 60_000);

      cleanupRef.current = () => {
        clearInterval(keepaliveInterval);
        clearTimeout(hardStop);
        close();
      };
    },
    cancel() {
      cleanupRef.current?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
