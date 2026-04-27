"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OnboardingShell } from "./_components/shell";
import { WelcomeStep } from "./_components/welcome-step";
import { ProfileStep } from "./_components/profile-step";
import { CapacityStep } from "./_components/capacity-step";
import { DoneStep } from "./_components/done-step";
import {
  saveProfileStep,
  saveCapacityStep,
  completeOnboarding,
  type ProfileInput,
  type CapacityInput,
} from "./_actions";

export type OnboardingMember = {
  id: string;
  name: string;
  role: string;
  specialty: string | null;
  seniority: string | null;
  githubUsername: string | null;
  fpCapacity: number;
  dedicationPercent: number;
};

const STEPS = ["welcome", "profile", "capacity", "done"] as const;
type StepId = (typeof STEPS)[number];

export function OnboardingClient({ member }: { member: OnboardingMember }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [profile, setProfile] = useState<ProfileInput>({
    specialty: (member.specialty as ProfileInput["specialty"]) ?? "fullstack",
    seniority: (member.seniority as ProfileInput["seniority"]) ?? "pleno",
    githubUsername: member.githubUsername ?? "",
  });

  const [capacity, setCapacity] = useState<CapacityInput>({
    fpCapacity: member.fpCapacity || 40,
    dedicationPercent: member.dedicationPercent || 100,
  });

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

    if (stepId === "welcome") {
      next();
      return;
    }

    if (stepId === "profile") {
      const handle = profile.githubUsername.trim().replace(/^@/, "");
      if (!handle) {
        setError("Coloca seu handle do GitHub.");
        return;
      }
      startTransition(async () => {
        try {
          await saveProfileStep(member.id, { ...profile, githubUsername: handle });
          setProfile((p) => ({ ...p, githubUsername: handle }));
          next();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Erro ao salvar perfil");
        }
      });
      return;
    }

    if (stepId === "capacity") {
      startTransition(async () => {
        try {
          await saveCapacityStep(member.id, capacity);
          next();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Erro ao salvar capacidade");
        }
      });
      return;
    }

    if (stepId === "done") {
      startTransition(async () => {
        try {
          await completeOnboarding(member.id);
          // completeOnboarding redirects on success
        } catch (e) {
          setError(e instanceof Error ? e.message : "Erro ao finalizar");
        }
      });
    }
  }

  const primaryLabel =
    stepId === "welcome"
      ? "Vamos lá"
      : stepId === "done"
      ? "Entrar no AgentOps"
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
          {stepId === "profile" && (
            <ProfileStep value={profile} onChange={setProfile} />
          )}
          {stepId === "capacity" && (
            <CapacityStep value={capacity} onChange={setCapacity} />
          )}
          {stepId === "done" && (
            <DoneStep
              memberName={member.name}
              role={member.role}
              specialty={profile.specialty}
              seniority={profile.seniority}
              fpCapacity={capacity.fpCapacity}
            />
          )}
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
