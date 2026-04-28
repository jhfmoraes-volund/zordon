"use client";

import { motion } from "framer-motion";
import { WelcomeScene } from "./scenes/welcome-scene";
import { TasksScene } from "./scenes/tasks-scene";
import { SprintsScene } from "./scenes/sprints-scene";
import { SkillsScene } from "./scenes/skills-scene";
import { PdiScene } from "./scenes/pdi-scene";
import { AgentsScene } from "./scenes/agents-scene";

type Props = {
  stepIndex: number;
  totalSteps: number;
  stepId: string;
  children: React.ReactNode;
};

export function OnboardingShell({
  stepIndex,
  totalSteps,
  stepId,
  children,
}: Props) {
  return (
    <div className="grid min-h-svh grid-cols-1 lg:grid-cols-2">
      {/* Painel esquerdo: cena animada — sempre visível.
          Mobile: 50svh no topo. Desktop: ocupa coluna inteira. */}
      <div className="relative order-1 h-[50svh] overflow-hidden border-b border-border bg-muted/30 pt-[env(safe-area-inset-top)] lg:order-1 lg:h-auto lg:min-h-svh lg:border-b-0 lg:border-r">
        <SceneFor stepId={stepId} />
      </div>

      {/* Painel direito: conteúdo + nav */}
      <div className="order-2 flex min-h-[50svh] flex-col pb-safe lg:order-2 lg:min-h-svh">
        {/* Header com progress pill — só aparece no desktop (mobile usa header flutuante) */}
        <header className="hidden items-center justify-between px-6 pb-5 pt-[calc(env(safe-area-inset-top)+1.25rem)] sm:px-10 lg:flex">
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Onboarding · Zordon
          </div>
          <ProgressPills stepIndex={stepIndex} total={totalSteps} />
        </header>

        {/* Header mobile flutuante por cima da cena */}
        <div className="pointer-events-none fixed inset-x-0 top-0 z-10 flex items-center justify-between px-6 pt-[calc(env(safe-area-inset-top)+0.75rem)] lg:hidden">
          <div className="rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground backdrop-blur">
            Zordon
          </div>
          <div className="rounded-full border border-border/60 bg-background/70 px-2.5 py-1 backdrop-blur">
            <ProgressPills stepIndex={stepIndex} total={totalSteps} />
          </div>
        </div>

        <div className="flex flex-1 items-start justify-center px-6 pb-10 pt-6 sm:px-10 lg:items-center lg:pt-0">
          <div className="flex w-full max-w-md flex-col gap-6 lg:gap-8">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function SceneFor({ stepId }: { stepId: string }) {
  if (stepId === "welcome") return <WelcomeScene />;
  if (stepId === "tasks") return <TasksScene />;
  if (stepId === "sprints") return <SprintsScene />;
  if (stepId === "skills") return <SkillsScene />;
  if (stepId === "pdi") return <PdiScene />;
  if (stepId === "agents") return <AgentsScene />;
  return null;
}

function ProgressPills({
  stepIndex,
  total,
}: {
  stepIndex: number;
  total: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => {
        const active = i === stepIndex;
        const done = i < stepIndex;
        return (
          <motion.span
            key={i}
            layout
            transition={{ type: "spring", damping: 22, stiffness: 240 }}
            className={[
              "h-1.5 rounded-full",
              active
                ? "w-8 bg-primary"
                : done
                ? "w-2 bg-primary/50"
                : "w-2 bg-muted",
            ].join(" ")}
            aria-current={active ? "step" : undefined}
          />
        );
      })}
    </div>
  );
}
