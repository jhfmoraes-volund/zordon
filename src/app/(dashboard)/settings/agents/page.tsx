"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
    description: "PM Review (notas, report, indicadores)",
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
      const previous = modes[slug] ?? "openrouter";
      setModes((m) => ({ ...m, [slug]: next }));
      setSavingSlug(slug);
      try {
        const res = await fetch("/api/agent-mode", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentSlug: slug, mode: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success(`Modo atualizado: ${slug} → ${next}`);
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="size-4" />
            Daemon local
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {loadingStatus ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : daemonOnline ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : (
                <XCircle className="size-4 text-muted-foreground" />
              )}
              <div className="text-sm">
                {daemonOnline ? (
                  <span>
                    <strong>{daemonStatus?.count}</strong> online ·{" "}
                    <code className="text-xs text-muted-foreground">
                      {firstDaemon?.daemonId.slice(0, 8)}
                    </code>{" "}
                    · heartbeat {firstDaemon && relativeAgo(firstDaemon.lastHeartbeatAt)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Nenhum daemon ativo. Modo &quot;Claude Daemon&quot; cai pra OpenRouter automaticamente.
                  </span>
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
          {!daemonOnline && (
            <p className="text-xs text-muted-foreground">
              Pra ativar: <code className="font-mono">bash scripts/daemon/daemon-ctl.sh start</code>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modo de execução por agente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TooltipProvider>
            {AGENTS.map((agent) => {
              const currentMode = modes[agent.slug] ?? "openrouter";
              const isSaving = savingSlug === agent.slug;
              const disabled = !agent.mcpReady;

              return (
                <div
                  key={agent.slug}
                  className="flex items-center justify-between border-b border-border/40 pb-3 last:border-none last:pb-0"
                >
                  <div>
                    <div className="font-medium text-sm">{agent.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {agent.description}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isSaving && (
                      <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                    )}
                    {disabled ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <div>
                              <Select disabled value={currentMode}>
                                <SelectTrigger className="w-[200px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="openrouter">OpenRouter</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          }
                        />
                        <TooltipContent>
                          MCP tools pendentes — disponível em fase seguinte
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Select
                        value={currentMode}
                        onValueChange={(v) =>
                          void handleChangeMode(agent.slug, v as AgentChatMode)
                        }
                      >
                        <SelectTrigger className="w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="openrouter">OpenRouter</SelectItem>
                          <SelectItem value="claude-daemon">Claude Daemon</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              );
            })}
          </TooltipProvider>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        ℹ Quando &quot;Claude Daemon&quot; estiver ativo e o daemon estiver offline, o agente
        cai automaticamente pra OpenRouter no próximo turn.
      </p>
    </div>
  );
}
