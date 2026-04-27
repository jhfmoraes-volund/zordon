"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { AGENT_SETTINGS_REGISTRY } from "@/lib/agent/settings-registry";
import { AlphaBadge } from "@/components/alpha-chat/alpha-badge";
import { VitorBadge } from "@/components/design-session/vitor-badge";

function AgentSlugBadge({ slug, name }: { slug: string; name: string }) {
  if (slug === "ops" || slug === "alpha") return <AlphaBadge size="md" label={name} />;
  if (slug === "design-session" || slug === "vitor") return <VitorBadge size="md" label={name} />;
  return (
    <span className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-muted/30 px-3 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-foreground/90">
      <Bot className="h-4 w-4 text-muted-foreground" />
      {name}
    </span>
  );
}

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
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1.5 min-w-0">
                      <AgentSlugBadge slug={a.slug} name={a.name} />
                      <p className="text-xs text-muted-foreground truncate font-mono pl-0.5">{a.slug}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
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
