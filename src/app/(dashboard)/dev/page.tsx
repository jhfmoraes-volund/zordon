import { History, X, Sparkles } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AgentBadge, type AgentSlug } from "@/components/agent-badge";
import { getCurrentMember } from "@/lib/dal";
import { resetOwnOnboarding } from "./_actions";

const AGENTS: AgentSlug[] = ["alpha", "vitor"];

export default async function DevSandboxPage() {
  const member = await getCurrentMember();
  const onboardedAt = member?.onboardedAt ?? null;

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
          <h2 className="text-lg font-semibold">Onboarding</h2>
          <p className="text-sm text-muted-foreground">
            Refaz o flow do zero. Zera <code>Member.onboardedAt</code> do
            membro atual e redireciona pra <code>/onboarding</code>.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              Testar onboarding
            </CardTitle>
            <CardDescription>
              Estado atual:{" "}
              {onboardedAt ? (
                <span className="font-mono text-foreground">
                  onboardedAt = {onboardedAt}
                </span>
              ) : (
                <span className="font-mono text-amber-500">
                  onboardedAt = null (já vai cair no flow no próximo nav)
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={resetOwnOnboarding}>
              <Button type="submit" size="lg">
                <Sparkles />
                Refazer onboarding
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Agent Badges</h2>
          <p className="text-sm text-muted-foreground">
            Block neon — gradiente diagonal, ícone integrado, sem glow externo.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Variações</CardTitle>
            <CardDescription>
              Tamanho <code>md</code> é o default. Dot de status é opcional
              (use <code>withDot</code> quando o agente estiver ativo).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6 rounded-lg bg-zinc-950 p-6">
              {AGENTS.map((agent) => (
                <div key={agent} className="space-y-3">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                    {agent}
                  </p>
                  <div className="flex flex-wrap items-center gap-4">
                    <Cell label="md (default)">
                      <AgentBadge agent={agent} />
                    </Cell>
                    <Cell label="md + dot">
                      <AgentBadge agent={agent} withDot />
                    </Cell>
                    <Cell label="md / no icon">
                      <AgentBadge agent={agent} withIcon={false} />
                    </Cell>
                    <Cell label="sm">
                      <AgentBadge agent={agent} size="sm" />
                    </Cell>
                    <Cell label="sm + dot">
                      <AgentBadge agent={agent} size="sm" withDot />
                    </Cell>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            Preview no contexto do painel (header h-12)
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {AGENTS.map((agent) => (
              <PanelHeaderPreview key={agent} agent={agent} />
            ))}
          </div>
        </div>
      </section>
    </div>
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
 * Replica visual do header do AlphaChatPanel — h-12, bg-muted/30 — para
 * validar como a badge se comporta no ambiente real onde será aplicada.
 */
function PanelHeaderPreview({ agent }: { agent: AgentSlug }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-zinc-950">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/50 bg-muted/30 px-4">
        <AgentBadge agent={agent} />
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
        {agent}
      </div>
    </div>
  );
}
