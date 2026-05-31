"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { AlertTriangle, CheckCircle2, Cpu } from "lucide-react";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type ActiveDaemon = {
  daemonId: string;
  hostname: string | null;
  startedAt: string;
  lastHeartbeatAt: string;
};

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 60) return `${sec}s atrás`;
  const min = Math.round(sec / 60);
  if (min < 60) return `há ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `há ${hr} h`;
  const days = Math.round(hr / 24);
  return `há ${days} d`;
}

function formatUptime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return remMin > 0 ? `${hr}h${remMin}m` : `${hr}h`;
  const days = Math.floor(hr / 24);
  const remHr = hr % 24;
  return remHr > 0 ? `${days}d${remHr}h` : `${days}d`;
}

export function ActiveBuilders() {
  const [daemons, setDaemons] = useState<ActiveDaemon[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0); // força re-render pra atualizar tempos

  useEffect(() => {
    const fetchActive = async () => {
      try {
        const res = await fetch("/api/forge/active-builders");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setDaemons((data.daemons ?? []) as ActiveDaemon[]);
      } catch (error) {
        console.error("Failed to fetch active builders:", error);
        setDaemons([]);
      } finally {
        setLoading(false);
      }
    };

    fetchActive();

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;

    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fetchActive, 500);
    };

    const channel = client
      .channel("active-builders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ForgeDaemon" },
        debouncedReload,
      )
      .subscribe();

    // Fallback poll + relógio pra atualizar "há X min"
    const poll = setInterval(fetchActive, 30_000);
    const clock = setInterval(() => setTick((t) => t + 1), 15_000);

    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      clearInterval(clock);
      client.removeChannel(channel);
    };
  }, []);

  // tick é usado pra re-render — sem usar diretamente referencia abaixo
  void tick;

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
        <Cpu className="size-4 animate-pulse" />
        <span>Verificando builders…</span>
      </div>
    );
  }

  if (daemons.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/40">
        <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
            Nenhum builder ativo
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
            Abra <code className="rounded bg-amber-100 px-1 py-0.5 dark:bg-amber-900/50">forge daemon</code>{" "}
            em algum PC para executar jobs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
      <div className="flex items-center gap-2">
        <span className="relative inline-flex size-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        <CheckCircle2 className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
        <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
          {daemons.length === 1
            ? "Forge conectada · 1 builder ativo"
            : `Forge conectada · ${daemons.length} builders ativos`}
        </p>
      </div>
      <ul className="mt-2 space-y-1 pl-6">
        {daemons.map((d) => (
          <li
            key={d.daemonId}
            className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-emerald-800 dark:text-emerald-300"
          >
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="size-3" />
              <span className="font-medium">
                {d.hostname ?? "host desconhecido"}
              </span>
            </span>
            <span className="text-emerald-700/70 dark:text-emerald-400/70">
              uptime{" "}
              <span className="font-mono tabular-nums">
                {formatUptime(d.startedAt)}
              </span>
            </span>
            <span className="text-emerald-700/70 dark:text-emerald-400/70">
              heartbeat{" "}
              <span className="font-mono tabular-nums">
                {formatRelative(d.lastHeartbeatAt)}
              </span>
            </span>
            <span className="font-mono text-[10px] text-emerald-700/60 dark:text-emerald-400/60">
              {d.daemonId.slice(0, 8)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
