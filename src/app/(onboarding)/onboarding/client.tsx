"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OnboardingShell } from "./_components/shell";
import { WelcomeStep } from "./_components/welcome-step";
import { TasksStep } from "./_components/tasks-step";
import { SprintsStep } from "./_components/sprints-step";
import { SkillsStep } from "./_components/skills-step";
import { PdiStep } from "./_components/pdi-step";
import { AgentsStep } from "./_components/agents-step";
import { completeOnboarding } from "./_actions";

export type OnboardingMember = {
  id: string;
  name: string;
};

const STEPS = [
  "welcome",
  "tasks",
  "sprints",
  "skills",
  "pdi",
  "agents",
] as const;
type StepId = (typeof STEPS)[number];

export function OnboardingClient({ member }: { member: OnboardingMember }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const stepId: StepId = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  function next() {
    setError(null);
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  function back() {
    setError(null);
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  function handlePrimary() {
    if (pending) return;

    if (!isLast) {
      next();
      return;
    }

    startTransition(async () => {
      try {
        await completeOnboarding(member.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao finalizar");
      }
    });
  }

  const primaryLabel = isFirst
    ? "Vamos lá"
    : isLast
    ? "Entrar no Zordon"
    : "Continuar";

  return (
    <OnboardingShell
      stepIndex={stepIndex}
      totalSteps={STEPS.length}
      stepId={stepId}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={stepId}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="flex flex-col gap-8"
        >
          {stepId === "welcome" && <WelcomeStep memberName={member.name} />}
          {stepId === "tasks" && <TasksStep />}
          {stepId === "sprints" && <SprintsStep />}
          {stepId === "skills" && <SkillsStep />}
          {stepId === "pdi" && <PdiStep />}
          {stepId === "agents" && <AgentsStep />}
        </motion.div>
      </AnimatePresence>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <Button
          variant="ghost"
          size="lg"
          onClick={back}
          disabled={isFirst || pending}
          className={isFirst ? "invisible" : ""}
        >
          <ArrowLeft />
          Voltar
        </Button>
        <Button size="lg" onClick={handlePrimary} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {primaryLabel}
          {!isLast && !pending ? <ArrowRight /> : null}
        </Button>
      </div>
    </OnboardingShell>
  );
}
