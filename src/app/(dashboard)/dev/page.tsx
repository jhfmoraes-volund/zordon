import { Bot, History, X } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AgentBadge, type AgentSlug } from "@/components/agent-badge";

const AGENTS: AgentSlug[] = ["alpha", "vitor"];

export default function DevSandboxPage() {
  return (
    <div className="container mx-auto max-w-6xl space-y-10 p-6">
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Sandbox</h1>
          <span className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            DEV
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Espaço para visualizar componentes em isolamento. Acesso restrito a
          Head Ops e CEO.
        </p>
      </header>

      <section className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Agent Badges</h2>
          <p className="text-sm text-muted-foreground">
            Duas variantes propostas — escolha qual segue como default no
            <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">
              AgentBadge
            </code>
            .
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <BadgeShowcaseCard
            title="Variante A — Pill"
            description="Contida, arredondada (rounded-full). Glow discreto. Padrão Linear/Vercel."
            variant="pill"
          />
          <BadgeShowcaseCard
            title="Variante B — Block"
            description="Mais marcante, rounded-md, gradiente diagonal e glow intenso. Padrão Raycast/Arcade."
            variant="block"
          />
        </div>

        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            Preview no contexto do painel (header h-12)
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {AGENTS.map((agent) => (
              <PanelHeaderPreview key={`pill-${agent}`} agent={agent} variant="pill" />
            ))}
            {AGENTS.map((agent) => (
              <PanelHeaderPreview key={`block-${agent}`} agent={agent} variant="block" />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function BadgeShowcaseCard({
  title,
  description,
  variant,
}: {
  title: string;
  description: string;
  variant: "pill" | "block";
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4 rounded-lg bg-zinc-950 p-6">
          {AGENTS.map((agent) => (
            <div key={agent} className="space-y-3">
              <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                {agent}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Cell label="md + dot">
                  <AgentBadge agent={agent} variant={variant} size="md" />
                </Cell>
                <Cell label="md + dot + icon">
                  <AgentBadge
                    agent={agent}
                    variant={variant}
                    size="md"
                    withIcon
                  />
                </Cell>
                <Cell label="md (no dot)">
                  <AgentBadge
                    agent={agent}
                    variant={variant}
                    size="md"
                    withDot={false}
                  />
                </Cell>
                <Cell label="sm + dot">
                  <AgentBadge agent={agent} variant={variant} size="sm" />
                </Cell>
                <Cell label="sm (no dot)">
                  <AgentBadge
                    agent={agent}
                    variant={variant}
                    size="sm"
                    withDot={false}
                  />
                </Cell>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      {children}
      <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-600">
        {label}
      </span>
    </div>
  );
}

/**
 * Replica visual do header do AlphaChatPanel ([panel.tsx:80](src/components/alpha-chat/panel.tsx#L80))
 * — h-12, bg-muted/30, border bottom — para validar como a badge se comporta
 * no ambiente real onde será aplicada.
 */
function PanelHeaderPreview({
  agent,
  variant,
}: {
  agent: AgentSlug;
  variant: "pill" | "block";
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-zinc-950">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/50 bg-muted/30 px-4">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <AgentBadge agent={agent} variant={variant} withDot={false} />
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-7" disabled>
            <History className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" disabled>
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="px-4 py-3 text-[10px] font-mono uppercase tracking-widest text-zinc-600">
        {agent} · {variant}
      </div>
    </div>
  );
}
