"use client";

import { useEffect, useState } from "react";
import {
  Link as LinkIcon,
  Eye,
  EyeOff,
  CheckCircle2,
  Circle,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

function IntegrationCard({ provider }: { provider: Provider }) {
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
  return <IntegrationCard provider="granola" />;
}
