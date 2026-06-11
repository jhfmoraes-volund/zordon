"use client";

import { useCallback, useEffect, useState } from "react";
import {
  GitBranch,
  FolderOpen,
  BookText,
  CheckCircle2,
  Loader2,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Status = {
  toolkit: string;
  status: string;
  connectedAccountId: string | null;
};

type ToolkitConfig = {
  toolkit: "github" | "googledrive" | "notion";
  title: string;
  icon: LucideIcon;
  description: string;
  connectLabel: string;
};

/**
 * Card de integração via Composio (OAuth gerenciado), parametrizado por toolkit.
 *
 * Fluxo:
 *  1. fetchStatus() ao montar
 *  2. "Conectar" → POST /connect → redirectUrl → window.location
 *  3. Pós-redirect, montagem refaz fetchStatus (que agora deve ter status='active')
 *  4. "Desconectar" → POST /disconnect → refresh
 */
function ComposioIntegrationCard({
  toolkit,
  title,
  icon: Icon,
  description,
  connectLabel,
}: ToolkitConfig) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`/api/integrations/composio/status?toolkit=${toolkit}`);
      if (!r.ok) {
        setStatus({ toolkit, status: "not_connected", connectedAccountId: null });
        return;
      }
      const data = (await r.json()) as Status;
      setStatus(data);
    } finally {
      setLoading(false);
    }
  }, [toolkit]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleConnect = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/integrations/composio/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkit, returnTo: "/settings/integrations" }),
      });
      const data = (await r.json()) as { redirectUrl?: string; error?: string };
      if (!r.ok || !data.redirectUrl) {
        toast.error(data.error ?? "Falha ao iniciar conexão");
        setBusy(false);
        return;
      }
      window.location.href = data.redirectUrl;
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/integrations/composio/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkit }),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !data.ok) {
        toast.error(data.error ?? "Falha ao desconectar");
        return;
      }
      toast.success(`${title} desconectado`);
      await fetchStatus();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isActive = status?.status === "active";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 space-y-3">
        <p className="text-sm text-muted-foreground">{description}</p>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Verificando status...
          </div>
        ) : isActive ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="font-medium">Conectado</span>
              {status?.connectedAccountId && (
                <span className="text-xs text-muted-foreground font-mono">
                  ({status.connectedAccountId.slice(0, 12)}…)
                </span>
              )}
            </div>
            <Button variant="outline" size="sm" disabled={busy} onClick={handleDisconnect}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Desconectar"}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {status?.status && status.status !== "not_connected" ? (
                <>
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  <span>Status: <code className="font-mono text-xs">{status.status}</code></span>
                </>
              ) : (
                <span>Não conectado</span>
              )}
            </div>
            <Button size="sm" disabled={busy} onClick={handleConnect}>
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Icon className="h-3.5 w-3.5" />
              )}
              {connectLabel}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function GitHubIntegrationCard() {
  return (
    <ComposioIntegrationCard
      toolkit="github"
      title="GitHub"
      icon={GitBranch}
      description="Conecte sua conta GitHub pra Vitória ler arquivos do repo (AGENTS.md, código) como contexto de planning. Conexão via Composio (OAuth gerenciado)."
      connectLabel="Conectar GitHub"
    />
  );
}

export function GoogleDriveIntegrationCard() {
  return (
    <ComposioIntegrationCard
      toolkit="googledrive"
      title="Google Drive"
      icon={FolderOpen}
      description="Conecte seu Google Drive pra sincronizar a pasta de documentos dos projetos (aba Drive). Quem salva a pasta no projeto vira o dono do sync. Conexão via Composio (OAuth gerenciado)."
      connectLabel="Conectar Google Drive"
    />
  );
}

export function NotionIntegrationCard() {
  return (
    <ComposioIntegrationCard
      toolkit="notion"
      title="Notion"
      icon={BookText}
      description="Conecte seu Notion pra importar páginas e bases como contexto dos projetos (insumos lidos pelos agentes e, futuramente, pela Wiki). Conexão via Composio (OAuth gerenciado)."
      connectLabel="Conectar Notion"
    />
  );
}
