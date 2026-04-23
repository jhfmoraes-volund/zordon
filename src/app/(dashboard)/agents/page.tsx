"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { AGENT_SETTINGS_REGISTRY } from "@/lib/agent/settings-registry";

type AgentRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  modelId: string;
  isActive: boolean;
  updatedAt: string;
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Falha ao carregar agentes");
        setAgents(data.agents || []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="Agentes" description="Ajuste parâmetros, playbooks e versões dos agentes." />

      {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && agents.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">Nenhum agente ativo.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => {
          const hasSchema = Boolean(AGENT_SETTINGS_REGISTRY[a.slug]);
          return (
            <Link key={a.id} href={`/agents/${a.slug}/settings`} className="group">
              <Card className="transition-colors group-hover:border-primary/50">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Bot className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-semibold truncate">{a.name}</h3>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </div>
                      <p className="text-xs text-muted-foreground truncate font-mono">{a.slug}</p>
                    </div>
                  </div>
                  {a.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">{a.description}</p>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono truncate">{a.modelId}</span>
                    <span className={hasSchema ? "text-green-600" : "text-amber-600"}>
                      {hasSchema ? "tunável" : "sem schema"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
