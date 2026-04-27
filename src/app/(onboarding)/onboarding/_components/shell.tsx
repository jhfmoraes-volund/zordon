"use client";

import { motion } from "framer-motion";
import { WelcomeScene } from "./scenes/welcome-scene";
import { ProfileScene } from "./scenes/profile-scene";
import { CapacityScene } from "./scenes/capacity-scene";
import { DoneScene } from "./scenes/done-scene";

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
      {/* Painel esquerdo: cena animada (some no mobile) */}
      <div className="relative hidden overflow-hidden border-r border-border bg-muted/30 lg:block">
        <SceneFor stepId={stepId} />
      </div>

      {/* Painel direito: conteúdo + nav */}
      <div className="flex min-h-svh flex-col">
        {/* Header com progress pill */}
        <header className="flex items-center justify-between px-6 py-5 sm:px-10">
          <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Onboarding · AgentOps
          </div>
          <ProgressPills stepIndex={stepIndex} total={totalSteps} />
        </header>

        <div className="flex flex-1 items-center justify-center px-6 pb-10 sm:px-10">
          <div className="flex w-full max-w-md flex-col gap-8">{children}</div>
        </div>
      </div>
    </div>
  );
}

function SceneFor({ stepId }: { stepId: string }) {
  if (stepId === "welcome") return <WelcomeScene />;
  if (stepId === "profile") return <ProfileScene />;
  if (stepId === "capacity") return <CapacityScene />;
  if (stepId === "done") return <DoneScene />;
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
