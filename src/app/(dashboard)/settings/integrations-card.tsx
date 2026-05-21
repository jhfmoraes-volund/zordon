"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Link as LinkIcon,
  Eye,
  EyeOff,
  CheckCircle2,
  Circle,
  Loader2,
  Zap,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

/**
 * Integration cards (Roam, Granola, …).
 *
 * Each card lets the signed-in member paste their personal API key for a
 * third-party transcript provider. The token is validated server-side
 * before being stored encrypted in Supabase Vault (RPCs in member-integrations).
 *
 * Both providers expose the exact same CRUD surface (GET/PUT/DELETE on
 * `/api/me/integrations/[provider]`) so this file defines one generic card
 * and two thin wrappers that lock in the copy/help text.
 */

// ─── Types ────────────────────────────────────────────────

type Provider = "roam" | "granola";

type Status = {
  connected: boolean;
  tokenHint: string | null;
  updatedAt: string | null;
};

type Feedback = { type: "success" | "error"; text: string } | null;

interface ProviderCopy {
  /** Human-readable name shown in the title. */
  label: string;
  /** Where the user can find/create the token (rendered as the help text). */
  howToFind: string;
  /** Placeholder shown inside the empty token input. */
  tokenPlaceholder: string;
  /** Single-line message shown right after a successful save. */
  successMessage: string;
  /** Single-line message shown right after a successful delete. */
  disconnectMessage: string;
}

const COPY: Record<Provider, ProviderCopy> = {
  roam: {
    label: "Roam",
    howToFind:
      "O token do Roam é pessoal. Gere o seu em Roam > Settings > API e cole abaixo. Ele é validado antes de ser salvo e fica criptografado no Supabase Vault.",
    tokenPlaceholder: "Cole o token do Roam",
    successMessage: "Roam conectado com sucesso.",
    disconnectMessage: "Roam desconectado.",
  },
  granola: {
    label: "Granola",
    howToFind:
      "A chave do Granola é pessoal (Personal API key). Gere a sua em Granola > Settings > Connectors > API keys > Create new key. Plano Business ou superior. Ela é validada antes de ser salva e fica criptografada no Supabase Vault.",
    tokenPlaceholder: "Cole a Personal API key do Granola (grn_…)",
    successMessage: "Granola conectado com sucesso.",
    disconnectMessage: "Granola desconectado.",
  },
};

// ─── Generic card ─────────────────────────────────────────

function IntegrationCard({
  provider,
  /** Extra UI rendered below the disconnect button when connected. Used by
   *  Granola to surface its auto-import opt-in widget without polluting the
   *  generic card with provider-specific logic. */
  extraConnectedSlot,
}: {
  provider: Provider;
  extraConnectedSlot?: React.ReactNode;
}) {
  const copy = COPY[provider];
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  async function loadStatus() {
    const res = await fetch(`/api/me/integrations/${provider}`);
    if (!res.ok) return;
    setStatus(await res.json());
  }

  async function handleSave() {
    setFeedback(null);
    if (!token.trim()) {
      setFeedback({ type: "error", text: "Informe o token." });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/me/integrations/${provider}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", text: data.error || "Erro ao salvar." });
        return;
      }
      setStatus(data);
      setToken("");
      setShowToken(false);
      setFeedback({ type: "success", text: copy.successMessage });
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setFeedback(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/me/integrations/${provider}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setFeedback({ type: "error", text: "Erro ao desconectar." });
        return;
      }
      setStatus(await res.json());
      setFeedback({ type: "success", text: copy.disconnectMessage });
    } finally {
      setDeleting(false);
    }
  }

  const tokenInputId = `${provider}-api-token`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <LinkIcon className="h-4 w-4" />
          Integração {copy.label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === null ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm">
              {status.connected ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-muted-foreground">
                    Conectado{status.tokenHint ? ` (****${status.tokenHint})` : ""}
                  </span>
                </>
              ) : (
                <>
                  <Circle className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Não conectado</span>
                </>
              )}
            </div>

            {status.connected ? (
              <>
                {feedback && (
                  <p
                    className={`text-sm ${
                      feedback.type === "success" ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {feedback.text}
                  </p>
                )}
                <Button
                  onClick={handleDisconnect}
                  disabled={deleting}
                  variant="outline"
                  className="w-full"
                >
                  {deleting ? "..." : "Desconectar"}
                </Button>
                {extraConnectedSlot}
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{copy.howToFind}</p>

                <div className="space-y-1.5">
                  <Label htmlFor={tokenInputId}>Token</Label>
                  <div className="relative">
                    <Input
                      id={tokenInputId}
                      name={tokenInputId}
                      type={showToken ? "text" : "password"}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      data-1p-ignore="true"
                      data-lpignore="true"
                      data-bwignore="true"
                      data-form-type="other"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder={copy.tokenPlaceholder}
                      onKeyDown={(e) => e.key === "Enter" && handleSave()}
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowToken(!showToken)}
                      tabIndex={-1}
                    >
                      {showToken ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {feedback && (
                  <p
                    className={`text-sm ${
                      feedback.type === "success" ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {feedback.text}
                  </p>
                )}

                <Button onClick={handleSave} disabled={saving} className="w-full">
                  {saving ? "Validando..." : "Conectar"}
                </Button>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Provider-specific wrappers ───────────────────────────

export function RoamIntegrationCard() {
  return <IntegrationCard provider="roam" />;
}

export function GranolaIntegrationCard() {
  return (
    <IntegrationCard
      provider="granola"
      extraConnectedSlot={<GranolaAutoImportBlock />}
    />
  );
}

// ─── Granola auto-import ──────────────────────────────────

type AutoImportStatus = {
  enabled: boolean;
  cursor: string | null;
  lastRunAt: string | null;
  lastJob: {
    id: string;
    status: "pending" | "running" | "done" | "failed";
    source: "cron" | "manual";
    notesScanned: number | null;
    meetingsCreated: number | null;
    meetingsSkipped: number | null;
    error: string | null;
    createdAt: string;
    finishedAt: string | null;
  } | null;
  inFlight: { id: string; status: "pending" | "running" } | null;
};

const ENDPOINT = "/api/me/integrations/granola/auto-import";

function GranolaAutoImportBlock() {
  const [status, setStatus] = useState<AutoImportStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const res = await fetch(ENDPOINT);
    if (!res.ok) {
      setLoadError(res.status === 409 ? "granola_not_connected" : `HTTP ${res.status}`);
      return;
    }
    setStatus((await res.json()) as AutoImportStatus);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While a job is in flight, poll every 4s so the user sees "varrendo
  // agora..." flip to "X reuniões criadas" without a manual refresh.
  useEffect(() => {
    if (!status?.inFlight) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [status?.inFlight, load]);

  async function handleToggle(next: boolean) {
    setFeedback(null);
    setToggling(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", text: data.error ?? "Erro ao atualizar." });
        return;
      }
      setStatus(data as AutoImportStatus);
      setFeedback({
        type: "success",
        text: next
          ? "Importação automática ligada. Próxima varredura na hora cheia."
          : "Importação automática desligada.",
      });
    } catch {
      setFeedback({ type: "error", text: "Erro de rede." });
    } finally {
      setToggling(false);
    }
  }

  async function handleRunNow() {
    setFeedback(null);
    setRunningNow(true);
    try {
      const res = await fetch(ENDPOINT, { method: "POST" });
      const data = await res.json();
      if (res.status === 409) {
        setFeedback({ type: "error", text: "Já tem uma varredura rodando." });
        await load();
        return;
      }
      if (!res.ok) {
        setFeedback({ type: "error", text: data.error ?? "Erro ao iniciar." });
        return;
      }
      setFeedback({
        type: "success",
        text: "Varredura iniciada — atualizando em alguns segundos.",
      });
      await load();
    } catch {
      setFeedback({ type: "error", text: "Erro de rede." });
    } finally {
      setRunningNow(false);
    }
  }

  if (loadError === "granola_not_connected") return null;

  return (
    <div className="space-y-3 pt-2">
      <Separator />

      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-amber-500" />
            Importação automática
          </p>
          <p className="text-xs text-muted-foreground">
            A cada 1h, novas reuniões viram Meetings privadas com notes e To-dos
            gerados automaticamente.
          </p>
        </div>
        <ToggleSwitch
          checked={status?.enabled ?? false}
          disabled={toggling || !status}
          onChange={(v) => void handleToggle(v)}
        />
      </div>

      {status?.enabled && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
          <AutoImportSummary status={status} />
          {status.inFlight ? (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Varrendo agora...
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={handleRunNow}
              disabled={runningNow}
            >
              {runningNow ? "Iniciando..." : "Varrer agora"}
            </Button>
          )}
        </div>
      )}

      {status?.lastJob?.error && status.lastJob.status === "failed" && (
        <div className="rounded-md border border-red-300/40 bg-red-50/40 dark:bg-red-950/20 px-3 py-2 text-xs text-red-900 dark:text-red-200 flex items-start gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Última varredura falhou: {status.lastJob.error}</span>
        </div>
      )}

      {feedback && (
        <p
          className={`text-xs ${
            feedback.type === "success" ? "text-green-600" : "text-red-600"
          }`}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}

function AutoImportSummary({ status }: { status: AutoImportStatus }) {
  const { lastRunAt, lastJob } = status;
  if (!lastRunAt) {
    return (
      <p className="text-muted-foreground">
        Aguardando a primeira varredura na próxima hora cheia.
      </p>
    );
  }
  const ago = relativeTime(lastRunAt);
  const created = lastJob?.meetingsCreated ?? 0;
  const skipped = lastJob?.meetingsSkipped ?? 0;
  return (
    <p className="text-muted-foreground">
      Última varredura {ago}
      {created > 0
        ? ` · ${created} reunião${created === 1 ? "" : "ões"} criada${created === 1 ? "" : "s"}`
        : " · sem novidades"}
      {skipped > 0 ? ` · ${skipped} já importada${skipped === 1 ? "" : "s"}` : ""}
    </p>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.round(diffMs / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.round(h / 24);
  return `há ${d}d`;
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${
        checked ? "bg-primary" : "bg-muted-foreground/30"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
