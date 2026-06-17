"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  fetchAllAgentModes,
  type AgentChatMode,
  type AgentSlug,
} from "@/hooks/use-agent-mode";
import { showErrorToast } from "@/lib/optimistic/toast";
import { toast } from "sonner";

type AgentDef = {
  slug: AgentSlug;
  name: string;
  description: string;
  mcpReady: boolean;
};

const AGENTS: AgentDef[] = [
  {
    slug: "vitor",
    name: "Vitor",
    description: "Discovery & PRDs em Design Sessions",
    mcpReady: true,
  },
  {
    slug: "vitoria",
    name: "Vitoria",
    description: "PM Review & Planning semanal",
    mcpReady: true,
  },
  {
    slug: "alpha",
    name: "Alpha",
    description: "Operações & Wiki",
    mcpReady: false,
  },
];

type DaemonStatus = {
  count: number;
  daemons: Array<{
    daemonId: string;
    hostname: string | null;
    startedAt: string;
    lastHeartbeatAt: string;
  }>;
};

function relativeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.round(diff / 1000)}s atrás`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}min atrás`;
  return `${Math.round(diff / 3_600_000)}h atrás`;
}

/**
 * Runtime EFETIVO de um agente agora — o que ele realmente usa, não só a
 * preferência salva. Daemon é o default de todos; OpenRouter é fallback.
 *   daemon       — preferência daemon + daemon online
 *   fallback     — preferência daemon mas daemon offline (OpenRouter automático)
 *   forced       — usuário forçou OpenRouter (override manual)
 *   mcp-pending  — agente ainda não tem MCP tools no daemon → só OpenRouter
 */
type Runtime = "daemon" | "fallback" | "forced" | "mcp-pending";

function effectiveRuntime(
  agent: AgentDef,
  mode: AgentChatMode,
  daemonOnline: boolean,
): Runtime {
  if (!agent.mcpReady) return "mcp-pending";
  if (mode === "openrouter") return "forced";
  return daemonOnline ? "daemon" : "fallback";
}

function RuntimeBadge({ runtime }: { runtime: Runtime }) {
  const map: Record<Runtime, { label: string; dot: string; text: string }> = {
    daemon: {
      label: "Daemon",
      dot: "bg-emerald-500",
      text: "text-emerald-600 dark:text-emerald-400",
    },
    fallback: {
      label: "Fallback · OpenRouter",
      dot: "bg-amber-500",
      text: "text-amber-600 dark:text-amber-400",
    },
    forced: {
      label: "OpenRouter (forçado)",
      dot: "bg-muted-foreground",
      text: "text-muted-foreground",
    },
    "mcp-pending": {
      label: "OpenRouter · MCP pendente",
      dot: "bg-muted-foreground",
      text: "text-muted-foreground",
    },
  };
  const s = map[runtime];
  return (
    <span className={`flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export default function AgentsSettingsPage() {
  const [modes, setModes] = useState<
    Partial<Record<AgentSlug, AgentChatMode>>
  >({});
  const [savingSlug, setSavingSlug] = useState<AgentSlug | null>(null);
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  // Carrega preferências do user
  useEffect(() => {
    void fetchAllAgentModes().then((rows) => {
      const map: Partial<Record<AgentSlug, AgentChatMode>> = {};
      for (const r of rows) map[r.agentSlug] = r.mode;
      setModes(map);
    });
  }, []);

  const refreshDaemonStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch("/api/forge/active-builders", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DaemonStatus;
      setDaemonStatus(data);
    } catch (e) {
      showErrorToast(e, { label: "Falha ao consultar daemon" });
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    // Inicial via setTimeout(0) pra setState não rodar sincronamente no
    // corpo do effect (react-hooks/set-state-in-effect). Subsequentes via
    // setInterval — setState em callback é OK.
    const tick = () => {
      void refreshDaemonStatus();
    };
    const initial = setTimeout(tick, 0);
    const interval = setInterval(tick, 30_000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [refreshDaemonStatus]);

  const handleChangeMode = useCallback(
    async (slug: AgentSlug, next: AgentChatMode) => {
      const previous = modes[slug] ?? "claude-daemon";
      setModes((m) => ({ ...m, [slug]: next }));
      setSavingSlug(slug);
      try {
        const res = await fetch("/api/agent-mode", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentSlug: slug, mode: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success(
          next === "claude-daemon"
            ? `${slug}: voltou pro daemon`
            : `${slug}: forçado em OpenRouter`,
        );
      } catch (e) {
        setModes((m) => ({ ...m, [slug]: previous }));
        showErrorToast(e, { label: "Falha ao salvar modo" });
      } finally {
        setSavingSlug(null);
      }
    },
    [modes],
  );

  const daemonOnline = (daemonStatus?.count ?? 0) > 0;
  const firstDaemon = daemonStatus?.daemons?.[0];
  // Até o 1º fetch resolver, status é desconhecido — mostra loader em vez de
  // piscar "offline" (daemonStatus null não significa daemon offline).
  const statusUnknown = daemonStatus === null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="size-4" />
            Runtime dos agentes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Headline — status vivo do daemon. Daemon é o default de todos;
              OpenRouter é a rede de segurança automática. */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              {statusUnknown ? (
                <Loader2 className="mt-0.5 size-3 animate-spin text-muted-foreground" />
              ) : (
                <span
                  className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
                    daemonOnline ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
              )}
              <div className="text-sm">
                {daemonOnline ? (
                  <>
                    <div className="font-medium">Conectado ao Daemon</div>
                    <div className="text-xs text-muted-foreground">
                      <code className="font-mono">
                        {firstDaemon?.daemonId.slice(0, 8)}
                      </code>
                      {firstDaemon ? ` · heartbeat ${relativeAgo(firstDaemon.lastHeartbeatAt)}` : ""}
                      {(daemonStatus?.count ?? 0) > 1
                        ? ` · ${daemonStatus?.count} online`
                        : ""}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      OpenRouter é o fallback automático se o daemon cair.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-medium">Daemon offline — fallback ativo</div>
                    <div className="text-xs text-muted-foreground">
                      Os agentes estão rodando em OpenRouter automaticamente.
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Pra ativar: <code className="font-mono">npm start</code> no repo{" "}
                      <code className="font-mono">zordon-daemon</code> (setup no README de lá).
                    </div>
                  </>
                )}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshDaemonStatus()}
              disabled={loadingStatus}
            >
              <RefreshCw className={loadingStatus ? "size-3.5 animate-spin" : "size-3.5"} />
              Testar conexão
            </Button>
          </div>

          {/* Estado efetivo por agente + override discreto. */}
          <TooltipProvider>
            <div className="divide-y divide-border/40 border-t border-border/40">
              {AGENTS.map((agent) => {
                const mode = modes[agent.slug] ?? "claude-daemon";
                const runtime = effectiveRuntime(agent, mode, daemonOnline);
                const isSaving = savingSlug === agent.slug;

                return (
                  <div
                    key={agent.slug}
                    className="flex items-center justify-between gap-3 py-3 first:pt-4"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{agent.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {agent.description}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {isSaving && (
                        <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                      )}
                      {runtime === "mcp-pending" ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <div>
                                <RuntimeBadge runtime={runtime} />
                              </div>
                            }
                          />
                          <TooltipContent>
                            MCP tools no daemon ainda pendentes — disponível em fase seguinte
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <RuntimeBadge runtime={runtime} />
                      )}
                      {agent.mcpReady && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-muted-foreground"
                          disabled={isSaving}
                          onClick={() =>
                            void handleChangeMode(
                              agent.slug,
                              mode === "openrouter" ? "claude-daemon" : "openrouter",
                            )
                          }
                        >
                          {mode === "openrouter" ? "Usar daemon" : "Forçar OpenRouter"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </TooltipProvider>
        </CardContent>
      </Card>
    </div>
  );
}
