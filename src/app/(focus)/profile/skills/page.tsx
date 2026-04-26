"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IntroStep } from "@/components/skill-assessment/intro-step";
import { TowerStep } from "@/components/skill-assessment/tower-step";
import { GoalsStep } from "@/components/skill-assessment/goals-step";
import { ReviewStep } from "@/components/skill-assessment/review-step";
import { DoneStep } from "@/components/skill-assessment/done-step";
import {
  TOWERS,
  type SubskillState,
  type SubskillMap,
  type MemberSkillRow,
} from "@/lib/memberSkills";

// stepIndex layout:
//   0           = intro
//   1..N        = towers
//   N+1         = goals
//   N+2         = review
//   N+3         = done
const TOWER_COUNT = TOWERS.length;
const GOALS_INDEX = TOWER_COUNT + 1;
const REVIEW_INDEX = TOWER_COUNT + 2;
const DONE_INDEX = TOWER_COUNT + 3;

type SkillState = {
  score: number | null;
  subskills: SubskillMap;
  cases: string;
};

type LoadedSkill = {
  towerKey: string;
  score: number | null;
  subskills: SubskillMap;
  cases?: string | null;
};

type LoadedAssessment = {
  status: "in_progress" | "completed";
  lastStepIndex: number;
  goals: string | null;
} | null;

const emptyState = (): SkillState => ({
  score: null,
  subskills: {},
  cases: "",
});

export default function SkillAssessmentPage() {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [skills, setSkills] = useState<Record<string, SkillState>>({});
  const [goals, setGoals] = useState("");
  const [hasPrevious, setHasPrevious] = useState(false);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const stateSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Load existing state ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/profile/skills");
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as {
        assessment: LoadedAssessment;
        skills: LoadedSkill[];
      };
      const map: Record<string, SkillState> = {};
      for (const s of data.skills) {
        map[s.towerKey] = {
          score: s.score ?? null,
          subskills: (s.subskills ?? {}) as SubskillMap,
          cases: s.cases ?? "",
        };
      }
      setSkills(map);
      setGoals(data.assessment?.goals ?? "");
      setHasPrevious(data.skills.length > 0);
      const resumeAt = data.assessment?.status === "completed"
        ? 0
        : Math.min(data.assessment?.lastStepIndex ?? 0, REVIEW_INDEX);
      setStepIndex(resumeAt);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Persistence ────────────────────────────────────────
  const persistTower = useCallback((towerKey: string, state: SkillState) => {
    const existingTimer = saveTimers.current[towerKey];
    if (existingTimer) clearTimeout(existingTimer);
    saveTimers.current[towerKey] = setTimeout(() => {
      fetch(`/api/profile/skills/${towerKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subskills: state.subskills,
          cases: state.cases,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          // Server returns the recomputed score — keep local state in sync.
          if (d?.ok && typeof d.score === "number") {
            setSkills((prev) => {
              const cur = prev[towerKey];
              if (!cur) return prev;
              return { ...prev, [towerKey]: { ...cur, score: d.score } };
            });
          }
        })
        .catch(() => {});
    }, 500);
  }, []);

  const persistState = useCallback(
    (patch: { lastStepIndex?: number; complete?: boolean; goals?: string }) => {
      if (stateSaveTimer.current) clearTimeout(stateSaveTimer.current);
      stateSaveTimer.current = setTimeout(() => {
        fetch("/api/profile/skills/state", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        }).catch(() => {});
      }, 200);
    },
    [],
  );

  // ─── Mutations ──────────────────────────────────────────
  const cycleSubskill = useCallback(
    (towerKey: string, subskillKey: string, nextState: SubskillState) => {
      setSkills((prev) => {
        const current = prev[towerKey] ?? emptyState();
        const subs = { ...current.subskills };
        if (nextState === "none") {
          delete subs[subskillKey];
        } else {
          subs[subskillKey] = nextState;
        }
        const next: SkillState = { ...current, subskills: subs };
        const out = { ...prev, [towerKey]: next };
        persistTower(towerKey, next);
        return out;
      });
    },
    [persistTower],
  );

  const setCases = useCallback(
    (towerKey: string, cases: string) => {
      setSkills((prev) => {
        const current = prev[towerKey] ?? emptyState();
        const next: SkillState = { ...current, cases };
        const out = { ...prev, [towerKey]: next };
        persistTower(towerKey, next);
        return out;
      });
    },
    [persistTower],
  );

  const updateGoals = useCallback(
    (next: string) => {
      setGoals(next);
      persistState({ goals: next });
    },
    [persistState],
  );

  // ─── Navigation ─────────────────────────────────────────
  const goTo = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(DONE_INDEX, idx));
      setStepIndex(clamped);
      if (clamped !== DONE_INDEX) {
        persistState({ lastStepIndex: clamped });
      }
    },
    [persistState],
  );

  const next = useCallback(() => goTo(stepIndex + 1), [stepIndex, goTo]);
  const prev = useCallback(() => goTo(stepIndex - 1), [stepIndex, goTo]);

  const complete = useCallback(() => {
    persistState({ lastStepIndex: REVIEW_INDEX, complete: true });
    setStepIndex(DONE_INDEX);
  }, [persistState]);

  // ─── Current tower (when on a tower step) ───────────────
  const currentTower = useMemo(() => {
    if (stepIndex < 1 || stepIndex > TOWER_COUNT) return null;
    return TOWERS[stepIndex - 1];
  }, [stepIndex]);

  const currentSkill = currentTower ? skills[currentTower.key] : null;

  // ─── Keyboard shortcuts ─────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (isTyping) {
        if (e.key === "Escape") target.blur();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          next();
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        router.push("/profile");
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) prev();
        else next();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router, prev, next]);

  if (!loaded) {
    return <div className="py-24 text-center text-sm text-muted-foreground">Carregando...</div>;
  }

  // ─── Progress ───────────────────────────────────────────
  const isOnTower = stepIndex >= 1 && stepIndex <= TOWER_COUNT;
  const isOnGoals = stepIndex === GOALS_INDEX;
  const towerProgress = isOnTower ? `${stepIndex} / ${TOWER_COUNT}` : null;

  // Wide layout for towers; narrow for intro/goals/review/done.
  const wide = isOnTower;
  const containerWidth = wide ? "max-w-6xl" : "max-w-3xl";

  return (
    <div className={`mx-auto ${containerWidth} px-6 lg:px-10 pt-6 pb-32 transition-[max-width] duration-300`}>
      {/* Progress bar */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-2 text-xs text-muted-foreground">
          <span>
            {stepIndex === 0 && "Introdução"}
            {isOnTower && `Torre ${towerProgress}`}
            {isOnGoals && "Objetivos profissionais"}
            {stepIndex === REVIEW_INDEX && "Revisão"}
            {stepIndex === DONE_INDEX && "Pronto"}
          </span>
          {isOnTower && (
            <span className="tabular-nums">
              {Math.round((stepIndex / TOWER_COUNT) * 100)}%
            </span>
          )}
        </div>
        <div className="h-1 rounded-full bg-muted overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={false}
            animate={{
              width: `${
                stepIndex === 0
                  ? 0
                  : stepIndex >= REVIEW_INDEX
                  ? 100
                  : isOnGoals
                  ? 100
                  : (stepIndex / TOWER_COUNT) * 100
              }%`,
            }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Step body */}
      <AnimatePresence mode="wait">
        <motion.div
          key={stepIndex}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.22 }}
        >
          {stepIndex === 0 && <IntroStep hasPrevious={hasPrevious} />}
          {currentTower && (
            <TowerStep
              tower={currentTower}
              subskills={currentSkill?.subskills ?? {}}
              cases={currentSkill?.cases ?? ""}
              onSubskillCycle={(subKey, state) =>
                cycleSubskill(currentTower.key, subKey, state)
              }
              onCasesChange={(text) => setCases(currentTower.key, text)}
            />
          )}
          {isOnGoals && (
            <GoalsStep goals={goals} onChange={updateGoals} />
          )}
          {stepIndex === REVIEW_INDEX && (
            <ReviewStep
              skills={
                Object.entries(skills).map(([towerKey, s]) => ({
                  towerKey,
                  score: s.score,
                  subskills: s.subskills,
                  cases: s.cases,
                })) as MemberSkillRow[]
              }
              goals={goals}
              onEditTower={(towerKey) => {
                const idx = TOWERS.findIndex((t) => t.key === towerKey);
                if (idx >= 0) goTo(idx + 1);
              }}
              onEditGoals={() => goTo(GOALS_INDEX)}
            />
          )}
          {stepIndex === DONE_INDEX && <DoneStep />}
        </motion.div>
      </AnimatePresence>

      {/* Footer nav */}
      {stepIndex !== DONE_INDEX && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border/50 bg-background/95 backdrop-blur">
          <div className={`mx-auto ${containerWidth} px-6 lg:px-10 py-3 flex items-center justify-between gap-2`}>
            <Button
              variant="ghost"
              onClick={prev}
              disabled={stepIndex === 0}
              size="sm"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Voltar
            </Button>

            <div className="flex items-center gap-2">
              {currentTower && (
                <Button variant="ghost" size="sm" onClick={next}>
                  <SkipForward className="h-4 w-4 mr-1" />
                  Pular torre
                </Button>
              )}
              {stepIndex === REVIEW_INDEX ? (
                <Button onClick={complete}>Salvar e publicar</Button>
              ) : (
                <Button onClick={next}>
                  {stepIndex === 0 ? "Começar" : "Próxima"}
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
