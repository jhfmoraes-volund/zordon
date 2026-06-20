"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./login.module.css";

type LineType = "info" | "ok" | "warn" | "dim" | "processing";

type Line = {
  type: LineType;
  text: string;
  tag: string;
  ts: number;
  procId?: string;
};

const LOG_POOL: { type: LineType; text: string; tag: string }[] = [
  { type: "info", tag: "scan",      text: "workspace volund-prod · 4 squads ativos" },
  { type: "ok",   tag: "sync",      text: "linear · 24 issues atualizadas" },
  { type: "info", tag: "metric",    text: "capacity 312/420 fp · semana corrente" },
  { type: "warn", tag: "alert",     text: "sprint volund-web v3 em 92% capacity" },
  { type: "info", tag: "agent",     text: "design-session.exec ready" },
  { type: "ok",   tag: "supabase",  text: "pool 8/16 conns idle" },
  { type: "info", tag: "scheduler", text: "próxima sync em 04:12" },
  { type: "ok",   tag: "model",     text: "claude-haiku-4.5 latency 180ms" },
  { type: "info", tag: "memory",    text: "contexto carregado · 7 squads" },
  { type: "info", tag: "task",      text: "14 in_progress · 3 em review" },
  { type: "warn", tag: "alert",     text: "cliente_x sla menor que 24h" },
  { type: "ok",   tag: "auth",      text: "sessão purgada · token rotacionado" },
  { type: "info", tag: "rpc",       text: "GET /sprints/active 200 · 42ms" },
  { type: "ok",   tag: "embed",     text: "1.2M vectors indexed" },
  { type: "info", tag: "node",      text: "br-sp-01 · cpu 12% · mem 38%" },
];

const PROCESS_LINES = [
  "síntese de design session",
  "estimativa de PFV · sprint volund-web v3",
  "agrupamento de insights · cliente_x",
  "calibragem de capacity por membro",
  "indexação de playbooks de discovery",
];

const BOOT_LINES: { type: LineType; text: string; tag: string }[] = [
  { type: "dim",  tag: "build",    text: "volund · zordon · 2026.04.25" },
  { type: "ok",   tag: "boot",     text: "kernel up" },
  { type: "ok",   tag: "boot",     text: "supabase://volund-prod conectado" },
  { type: "ok",   tag: "boot",     text: "tls 1.3 handshake ok" },
  { type: "ok",   tag: "boot",     text: "12 playbooks carregados" },
  { type: "info", tag: "ready",    text: "aguardando operador" },
];

const LINE_CLASS: Record<LineType, string> = {
  info:       styles.lineInfo,
  ok:         styles.lineOk,
  warn:       styles.lineWarn,
  dim:        styles.lineDim,
  processing: styles.lineProc,
};

function appendLine(prev: Line[], next: Line): Line[] {
  const arr = [...prev, next];
  return arr.length > 60 ? arr.slice(arr.length - 50) : arr;
}

function formatTime(ms: number): string {
  const dt = new Date(ms);
  return [dt.getHours(), dt.getMinutes(), dt.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export function LiveStream({ focusActive }: { focusActive: boolean }) {
  const [lines, setLines] = useState<Line[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusActiveRef = useRef(focusActive);

  useEffect(() => {
    focusActiveRef.current = focusActive;
  }, [focusActive]);

  useEffect(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    let acc = 0;
    BOOT_LINES.forEach((row) => {
      acc += 200;
      timeouts.push(
        setTimeout(() => {
          setLines((prev) => appendLine(prev, { ...row, ts: Date.now() }));
        }, acc),
      );
    });
    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    let nextTimer: ReturnType<typeof setTimeout> | undefined;
    const resolveTimers: ReturnType<typeof setTimeout>[] = [];

    function loop() {
      const r = Math.random();
      if (r < 0.22) {
        const txt = PROCESS_LINES[Math.floor(Math.random() * PROCESS_LINES.length)];
        const procId = `proc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setLines((prev) =>
          appendLine(prev, {
            type: "processing",
            text: txt,
            tag: "proc",
            ts: Date.now(),
            procId,
          }),
        );
        resolveTimers.push(
          setTimeout(() => {
            setLines((prev) =>
              prev.map((l) =>
                l.procId === procId
                  ? { ...l, type: "ok", tag: "done", text: txt }
                  : l,
              ),
            );
          }, 1100 + Math.random() * 900),
        );
      } else {
        const row = LOG_POOL[Math.floor(Math.random() * LOG_POOL.length)];
        setLines((prev) => appendLine(prev, { ...row, ts: Date.now() }));
      }
      const baseDelay = focusActiveRef.current ? 700 : 1600;
      nextTimer = setTimeout(loop, baseDelay + Math.random() * 1100);
    }

    nextTimer = setTimeout(loop, 2000);
    return () => {
      if (nextTimer) clearTimeout(nextTimer);
      resolveTimers.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className={styles.stream} ref={scrollRef}>
      {lines.map((l, i) => (
        <div key={i} className={`${styles.line} ${LINE_CLASS[l.type]}`}>
          <span className={styles.ts}>{formatTime(l.ts)}</span>
          <span
            className={`${styles.txt} ${l.type === "processing" ? styles.shimmer : ""}`}
          >
            {l.text}
          </span>
          <span className={styles.tag}>{l.tag}</span>
        </div>
      ))}
    </div>
  );
}
