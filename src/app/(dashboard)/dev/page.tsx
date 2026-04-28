import { Sparkles } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getCurrentMember } from "@/lib/dal";
import { resetOwnOnboarding } from "./_actions";

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
    </div>
  );
}
