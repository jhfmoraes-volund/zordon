"use client";

import { useState } from "react";
import { Send, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { useTelegramConnection } from "@/hooks/use-telegram-connection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const KINDS: Array<{ id: string; label: string; description: string }> = [
  {
    id: "mention",
    label: "Menções em comentários",
    description: "Quando alguém te marca com @ num comentário",
  },
  {
    id: "assigned",
    label: "Atribuição em tasks",
    description: "Quando uma task é atribuída a você",
  },
  {
    id: "status_changed",
    label: "Mudanças de status",
    description: "Quando o status de uma task sua muda",
  },
  {
    id: "sprint_started",
    label: "Sprints iniciadas",
    description: "Quando uma sprint do seu projeto começa",
  },
  {
    id: "sprint_ended",
    label: "Sprints encerradas",
    description: "Quando uma sprint do seu projeto termina",
  },
  {
    id: "agent_task_change",
    label: "Mudanças do Alpha em massa",
    description: "Quando o Alpha atualiza várias tasks de uma vez",
  },
  {
    id: "daily_todos",
    label: "Resumo diário de to-dos",
    description: "Lembrete de manhã e à noite com seus to-dos",
  },
];

const DEFAULT_DISABLED: string[] = [
  "status_changed",
  "sprint_started",
  "sprint_ended",
  "agent_task_change",
];

// Generate 06:00–22:00 in 30-min steps for the time pickers.
const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let h = 6; h <= 22; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 22) out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
})();

export function TelegramCard() {
  const { member } = useAuth();
  const memberId = member?.id ?? null;
  const { status, loading, refresh } = useTelegramConnection(memberId);
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);

  if (!memberId) return null;

  async function handleConnect() {
    setConnecting(true);
    try {
      const res = await fetch("/api/me/telegram/bind-link", { method: "POST" });
      if (!res.ok) throw new Error("Falha ao gerar link");
      const { url } = (await res.json()) as { url: string };
      window.open(url, "_blank", "noopener,noreferrer");
      toast.message("Abrindo Telegram…", {
        description: "Aperte INICIAR no chat com o bot pra concluir.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao conectar");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    const res = await fetch("/api/me/telegram", { method: "DELETE" });
    if (!res.ok) {
      toast.error("Falha ao desconectar");
      return;
    }
    await refresh();
    toast.success("Telegram desconectado");
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/me/telegram/test", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? "Falha ao enviar teste",
        );
      }
      toast.success("Mensagem de teste enviada", {
        description: "Veja seu Telegram.",
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao enviar teste");
    } finally {
      setTesting(false);
    }
  }

  async function toggleKind(kindId: string) {
    const next = status.kindsDisabled.includes(kindId)
      ? status.kindsDisabled.filter((k) => k !== kindId)
      : [...status.kindsDisabled, kindId];
    const res = await fetch("/api/me/telegram", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kindsDisabled: next }),
    });
    if (!res.ok) {
      toast.error("Falha ao salvar preferência");
      return;
    }
    await refresh();
  }

  async function updatePrefs(patch: Record<string, unknown>) {
    const res = await fetch("/api/me/telegram", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      toast.error("Falha ao salvar preferência");
      return;
    }
    await refresh();
  }

  const effectiveDisabled = status.connected
    ? status.kindsDisabled
    : DEFAULT_DISABLED;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Send className="size-4 text-[#229ED9]" />
            <CardTitle className="text-base">Telegram</CardTitle>
          </div>
          {!loading && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                status.connected
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {status.connected ? (
                <>
                  <CheckCircle2 className="size-3" /> Conectado
                </>
              ) : (
                <>
                  <AlertCircle className="size-3" /> Desconectado
                </>
              )}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : !status.connected ? (
          <>
            <p className="text-sm text-muted-foreground">
              Receba notificações importantes direto no Telegram. Conecte sua
              conta em 2 cliques.
            </p>
            <Button onClick={handleConnect} disabled={connecting}>
              {connecting ? "Gerando link…" : "Conectar Telegram"}
            </Button>
          </>
        ) : (
          <>
            <div className="text-sm text-muted-foreground">
              {status.username ? (
                <>
                  Conectado como{" "}
                  <span className="font-medium text-foreground">
                    @{status.username}
                  </span>
                </>
              ) : (
                "Conectado."
              )}
              {status.connectedAt && (
                <> · {fmtRelative(status.connectedAt)}</>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Notificar sobre
              </p>
              <ul className="space-y-1">
                {KINDS.map((kind) => {
                  const enabled = !effectiveDisabled.includes(kind.id);
                  return (
                    <li key={kind.id}>
                      <button
                        type="button"
                        onClick={() => toggleKind(kind.id)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors",
                          "hover:bg-accent",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "mt-0.5 inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
                            enabled ? "bg-emerald-500" : "bg-muted",
                          )}
                        >
                          <span
                            className={cn(
                              "inline-block size-3 rounded-full bg-white transition-transform",
                              enabled ? "translate-x-3.5" : "translate-x-0.5",
                            )}
                          />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium">
                            {kind.label}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {kind.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Lembretes diários de to-dos
              </p>
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <DailyTodoSlot
                  label="Manhã"
                  emoji="☀️"
                  enabled={status.dailyTodosMorningEnabled}
                  time={status.dailyTodosMorningTime}
                  onToggle={(v) =>
                    updatePrefs({ dailyTodosMorningEnabled: v })
                  }
                  onTimeChange={(v) =>
                    updatePrefs({ dailyTodosMorningTime: v })
                  }
                />
                <DailyTodoSlot
                  label="Noite"
                  emoji="🌙"
                  enabled={status.dailyTodosEveningEnabled}
                  time={status.dailyTodosEveningTime}
                  onToggle={(v) =>
                    updatePrefs({ dailyTodosEveningEnabled: v })
                  }
                  onTimeChange={(v) =>
                    updatePrefs({ dailyTodosEveningTime: v })
                  }
                />
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Sem to-dos abertos no horário, nada é enviado.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing}
              >
                {testing ? "Enviando…" : "Enviar teste"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                className="text-muted-foreground hover:text-foreground"
              >
                Desconectar
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DailyTodoSlot({
  label,
  emoji,
  enabled,
  time,
  onToggle,
  onTimeChange,
}: {
  label: string;
  emoji: string;
  enabled: boolean;
  time: string;
  onToggle: (next: boolean) => void;
  onTimeChange: (next: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onToggle(!enabled)}
        className="flex flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-accent"
      >
        <span
          aria-hidden
          className={cn(
            "inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
            enabled ? "bg-emerald-500" : "bg-muted-foreground/30",
          )}
        >
          <span
            className={cn(
              "inline-block size-3 rounded-full bg-white transition-transform",
              enabled ? "translate-x-3.5" : "translate-x-0.5",
            )}
          />
        </span>
        <span className="text-sm">
          {emoji} {label}
        </span>
      </button>
      <select
        value={time}
        disabled={!enabled}
        onChange={(e) => onTimeChange(e.target.value)}
        className={cn(
          "rounded-md border bg-background px-2 py-1 text-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          !enabled && "opacity-40 cursor-not-allowed",
        )}
      >
        {TIME_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `há ${d} dias`;
  return new Date(iso).toLocaleDateString("pt-BR");
}
