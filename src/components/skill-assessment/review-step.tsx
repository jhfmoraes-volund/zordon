"use client";

import { Star, Sparkles, FileText, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SkillBars } from "./skill-bars";
import {
  TOWERS,
  isFullstack,
  derivePrimaryTowers,
  towerLabel,
  scoreLabel,
  type MemberSkillRow,
} from "@/lib/memberSkills";

type Props = {
  skills: MemberSkillRow[];
  goals: string;
  onEditTower: (towerKey: string) => void;
  onEditGoals: () => void;
};

export function ReviewStep({ skills, goals, onEditTower, onEditGoals }: Props) {
  const fullstack = isFullstack(skills);
  const { primary, secondary } = derivePrimaryTowers(skills);
  const scores: Partial<Record<string, number | null>> = Object.fromEntries(
    skills.map((s) => [s.towerKey, s.score]),
  );

  const summaries = TOWERS.map((tower) => {
    const skill = skills.find((s) => s.towerKey === tower.key);
    const subs = skill?.subskills ?? {};
    const subskillCount = Object.keys(subs).length;
    const refCount = Object.values(subs).filter((v) => v === "ref").length;
    const hasCases = !!skill?.cases?.trim();
    const empty = subskillCount === 0 && !hasCases;
    return {
      towerKey: tower.key,
      label: tower.label,
      subskillCount,
      refCount,
      hasCases,
      empty,
      score: skill?.score ?? null,
    };
  });

  const refSubskills: { towerKey: string; subskillKey: string; label: string }[] = [];
  for (const s of skills) {
    const tower = TOWERS.find((t) => t.key === s.towerKey);
    if (!tower) continue;
    for (const [k, state] of Object.entries(s.subskills ?? {})) {
      if (state !== "ref") continue;
      const sub = tower.subskills.find((sub) => sub.key === k);
      if (!sub) continue;
      refSubskills.push({ towerKey: s.towerKey, subskillKey: k, label: sub.label });
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs text-primary mb-3">
          <Sparkles className="h-3 w-3" />
          Revisão
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Confira sua avaliação</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Score 0-100 calculado a partir das suas marcações. Clique numa torre pra ajustar.
        </p>
      </div>

      <div className="rounded-xl border border-foreground/10 bg-muted/20 p-6 space-y-4">
        <div className="flex items-center flex-wrap gap-2">
          {primary && (
            <Badge variant="default" className="text-xs">
              Torre primária · {towerLabel(primary)}
            </Badge>
          )}
          {secondary && (
            <Badge variant="secondary" className="text-xs">
              Secundária · {towerLabel(secondary)}
            </Badge>
          )}
          {fullstack && (
            <Badge className="text-xs bg-amber-500/15 text-amber-600 border-amber-500/30 border hover:bg-amber-500/15">
              <Star className="h-3 w-3 mr-1 fill-current" />
              Fullstack
            </Badge>
          )}
        </div>

        <SkillBars scores={scores} onTowerClick={onEditTower} />

        {refSubskills.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Referência em
            </p>
            <div className="flex flex-wrap gap-1.5">
              {refSubskills.map((r) => (
                <span
                  key={`${r.towerKey}.${r.subskillKey}`}
                  className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-2.5 py-1 text-xs font-medium"
                >
                  <Star className="h-3 w-3 fill-current" />
                  {r.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onEditGoals}
        className="w-full text-left rounded-xl border border-foreground/10 px-5 py-4 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Objetivos profissionais
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="text-sm mt-1 line-clamp-3">
          {goals?.trim()
            ? goals
            : <span className="italic text-muted-foreground">Não preenchido — clique pra adicionar.</span>}
        </p>
      </button>

      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Suas respostas por torre
        </p>
        <div className="rounded-xl border border-foreground/10 divide-y divide-foreground/5">
          {summaries.map((s) => (
            <button
              key={s.towerKey}
              type="button"
              onClick={() => onEditTower(s.towerKey)}
              className="w-full flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
            >
              <span className="flex-1 text-sm font-medium">{s.label}</span>
              <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
                {s.empty ? (
                  <span className="italic">Não respondida</span>
                ) : (
                  <>
                    <span>
                      {s.subskillCount} subskill{s.subskillCount === 1 ? "" : "s"}
                      {s.refCount > 0 && (
                        <span className="ml-1 text-amber-600">★{s.refCount}</span>
                      )}
                    </span>
                    {s.hasCases && (
                      <span className="inline-flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        caso
                      </span>
                    )}
                    {s.score !== null && (
                      <Badge variant="secondary" className="text-[10px]">
                        {s.score} · {scoreLabel(s.score)}
                      </Badge>
                    )}
                  </>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
