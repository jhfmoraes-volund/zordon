"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./login.module.css";

type LineType = "info" | "ok" | "warn" | "dim" | "processing";

type Line = {
  type: LineType;
  text: string;
  ts: number;
  procId?: string;
};

const LOG_POOL: { type: LineType; text: string }[] = [
  { type: "info", text: "scan :: workspace=volund-prod active_squads=4" },
  { type: "ok",   text: "sync :: linear → 24 issues atualizadas" },
  { type: "info", text: "metric :: capacity[esta semana] = 312/420 FP" },
  { type: "warn", text: "alert :: sprint Volund-Web v3 em 92% capacity" },
  { type: "info", text: "agent :: design-session.exec ready" },
  { type: "ok",   text: "supabase :: pool 8/16 conns idle" },
  { type: "info", text: "scheduler :: próxima sync em 04:12" },
  { type: "ok",   text: "model :: claude-haiku-4.5 latency=180ms" },
  { type: "info", text: "memory :: contexto carregado para 7 squads" },
  { type: "info", text: "task :: 14 tarefas em in_progress · 3 em review" },
  { type: "warn", text: "alert :: cliente_x sla < 24h restantes" },
  { type: "ok",   text: "auth :: sessão purgada · token rotacionado" },
  { type: "info", text: "rpc :: GET /sprints/active 200 · 42ms" },
  { type: "info", text: "agent :: zordon.estimate ready" },
  { type: "ok",   text: "embeddings :: 1.2M vectors indexed" },
  { type: "info", text: "node :: br-sp-01 · cpu 12% · mem 38%" },
];

const PROCESS_LINES = [
  "processando síntese de design session…",
  "estimando function points · sprint volund-web v3…",
  "agrupando insights · cliente_x reunião 04/24…",
  "calibrando capacity por membro…",
  "indexando playbooks de discovery…",
];

const BOOT_LINES: { type: LineType; text: string }[] = [
  { type: "dim",  text: "// volund · zordon · build 2026.04.25" },
  { type: "ok",   text: "[boot] núcleo iniciado" },
  { type: "ok",   text: "[boot] supabase://volund-prod conectado" },
  { type: "ok",   text: "[boot] handshake TLS 1.3 ok" },
  { type: "ok",   text: "[boot] 12 playbooks carregados" },
  { type: "info", text: "[boot] sistema online · aguardando operador" },
];

const TLINE_CLASS: Record<LineType, string> = {
  info: styles.tlineInfo,
  ok: styles.tlineOk,
  warn: styles.tlineWarn,
  dim: styles.tlineDim,
  processing: styles.tlineProcessing,
};

function appendLine(prev: Line[], next: Line): Line[] {
  const arr = [...prev, next];
  return arr.length > 90 ? arr.slice(arr.length - 70) : arr;
}

function formatTime(ms: number): string {
  const dt = new Date(ms);
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  const ss = String(dt.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function LiveTerminal({ focusActive }: { focusActive: boolean }) {
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
      acc += 180;
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
      if (r < 0.25) {
        const txt = PROCESS_LINES[Math.floor(Math.random() * PROCESS_LINES.length)];
        const procId = `proc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setLines((prev) =>
          appendLine(prev, { type: "processing", text: txt, ts: Date.now(), procId }),
        );
        resolveTimers.push(
          setTimeout(() => {
            setLines((prev) =>
              prev.map((l) =>
                l.procId === procId
                  ? { ...l, type: "ok", text: "✓ " + txt.replace("…", " concluído") }
                  : l,
              ),
            );
          }, 1100 + Math.random() * 900),
        );
      } else {
        const row = LOG_POOL[Math.floor(Math.random() * LOG_POOL.length)];
        setLines((prev) => appendLine(prev, { ...row, ts: Date.now() }));
      }
      const baseDelay = focusActiveRef.current ? 600 : 1400;
      nextTimer = setTimeout(loop, baseDelay + Math.random() * 1100);
    }

    nextTimer = setTimeout(loop, 1800);
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
    <div className={styles.terminal}>
      <div className={styles.terminalHead}>
        <div className={styles.terminalHeadL}>
          <span className={`${styles.dot} ${styles.dotR}`} />
          <span className={`${styles.dot} ${styles.dotY}`} />
          <span className={`${styles.dot} ${styles.dotG}`} />
          <span className={styles.terminalTitle}>zordon@br-sp-01 — live</span>
        </div>
        <div className={styles.terminalHeadR}>
          <span className={styles.statusDot} />
          <span>STREAM</span>
        </div>
      </div>
      <div className={styles.terminalBody} ref={scrollRef}>
        {lines.map((l, i) => (
          <div key={i} className={`${styles.tline} ${TLINE_CLASS[l.type]}`}>
            <span className={styles.ts}>{formatTime(l.ts)}</span>
            <span className={`${styles.txt} ${l.type === "processing" ? styles.shimmer : ""}`}>
              {l.text}
            </span>
          </div>
        ))}
        <div className={`${styles.tline} ${styles.tlinePrompt}`}>
          <span className={styles.promptArrow}>›</span>
          <span className={styles.caret} />
        </div>
      </div>
    </div>
  );
}
