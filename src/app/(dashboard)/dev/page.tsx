import Link from "next/link";
import { BookOpen, Sparkles, Tag } from "lucide-react";
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
          PM, Head Ops e CEO.
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
          <h2 className="text-lg font-semibold">Mocks de schema</h2>
          <p className="text-sm text-muted-foreground">
            Visualizações de planos em discussão antes de virar migration.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="size-4 text-primary" />
              Story Hierarchy V2
            </CardTitle>
            <CardDescription>
              Module → UserStory → Task com AC como entidade, persona
              estruturada, refinement status e computed status. Mock estático,
              não toca o banco.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              size="lg"
              variant="outline"
              render={<Link href="/dev/stories" />}
            >
              <BookOpen />
              Abrir mock
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="size-4 text-primary" />
              Tags (substitui task.area)
            </CardTitle>
            <CardDescription>
              Três variações de chip (Solid / Notion / Linear) com picker,
              create-on-the-fly, color menu e demo de overflow +N na lista.
              Mock 100% client-side.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              size="lg"
              variant="outline"
              render={<Link href="/dev/tags" />}
            >
              <Tag />
              Abrir sandbox
            </Button>
          </CardContent>
        </Card>
      </section>

    </div>
  );
}
