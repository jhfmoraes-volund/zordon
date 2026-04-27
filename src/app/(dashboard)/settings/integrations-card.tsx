"use client";

import { useEffect, useState } from "react";
import { Link as LinkIcon, Eye, EyeOff, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Status = {
  connected: boolean;
  tokenHint: string | null;
  updatedAt: string | null;
};

type Feedback = { type: "success" | "error"; text: string } | null;

export function RoamIntegrationCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    const res = await fetch("/api/me/integrations/roam");
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
      const res = await fetch("/api/me/integrations/roam", {
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
      setFeedback({ type: "success", text: "Roam conectado com sucesso." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setFeedback(null);
    setDeleting(true);
    try {
      const res = await fetch("/api/me/integrations/roam", { method: "DELETE" });
      if (!res.ok) {
        setFeedback({ type: "error", text: "Erro ao desconectar." });
        return;
      }
      setStatus(await res.json());
      setFeedback({ type: "success", text: "Roam desconectado." });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <LinkIcon className="h-4 w-4" />
          Integracao Roam
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
                  <span className="text-muted-foreground">Nao conectado</span>
                </>
              )}
            </div>

            {status.connected ? (
              <>
                {feedback && (
                  <p className={`text-sm ${feedback.type === "success" ? "text-green-600" : "text-red-600"}`}>
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
                <p className="text-sm text-muted-foreground">
                  O token do Roam e pessoal. Gere o seu em Roam &gt; Settings &gt; API,
                  cole abaixo. Ele e validado antes de ser salvo e fica criptografado
                  no Supabase Vault.
                </p>

                <div className="space-y-1.5">
                  <Label htmlFor="roam-api-token">Token</Label>
                  <div className="relative">
                    <Input
                      id="roam-api-token"
                      name="roam-api-token"
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
                      placeholder="Cole o token do Roam"
                      onKeyDown={(e) => e.key === "Enter" && handleSave()}
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowToken(!showToken)}
                      tabIndex={-1}
                    >
                      {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {feedback && (
                  <p className={`text-sm ${feedback.type === "success" ? "text-green-600" : "text-red-600"}`}>
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
