"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const DAEMON_CMD = "npx tsx scripts/forge/daemon.ts";

type ActiveBuilders = {
  count: number;
  daemons: Array<{
    daemonId: string;
    hostname: string | null;
    heartbeatAt: string | null;
  }>;
};

/**
 * Banner avisando que não há daemons (builders) ativos pra processar jobs.
 *
 * Daemon é um processo local — a web não pode iniciar. Quando count=0,
 * mostramos o comando exato pro dev rodar no terminal.
 *
 * Hide-by-default: só aparece quando count realmente é 0 (após primeiro fetch).
 */
export function NoBuildersBanner({ className }: { className?: string }) {
  const [data, setData] = useState<ActiveBuilders | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/forge/active-builders", {
          cache: "no-store",
        });
        if (!r.ok) return;
        const json = (await r.json()) as ActiveBuilders;
        if (alive) setData(json);
      } catch {
        // silent
      }
    };
    load();
    const id = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Esconde até saber pelo menos uma vez.
  if (!data || data.count > 0) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(DAEMON_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // browser pode bloquear; sem fallback
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-amber-300/60 bg-amber-50/40 p-4 dark:border-amber-900/60 dark:bg-amber-950/30",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Nenhum builder ativo
          </p>
          <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-300/80">
            Runs disparados ficam em <code>queued</code> até um daemon local
            claim o job. Daemon é um processo na sua máquina (não no servidor)
            — rode no terminal:
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <code className="flex-1 min-w-0 truncate rounded bg-amber-100/70 px-2 py-1.5 font-mono text-[11px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
              {DAEMON_CMD}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-100 px-2 py-1.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-200 dark:border-amber-800 dark:bg-amber-900/60 dark:text-amber-100 dark:hover:bg-amber-900"
              title={copied ? "Copiado" : "Copiar comando"}
            >
              {copied ? (
                <>
                  <Check className="size-3" /> ok
                </>
              ) : (
                <>
                  <Copy className="size-3" /> copiar
                </>
              )}
            </button>
          </div>
          <p className="mt-2 text-[10px] text-amber-700/70 dark:text-amber-300/60">
            Daemon usa <code>claude -p</code> autenticado localmente — por isso
            só roda na sua máquina, não no servidor web.
          </p>
        </div>
      </div>
    </div>
  );
}
