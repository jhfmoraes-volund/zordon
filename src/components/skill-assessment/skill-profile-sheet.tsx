"use client";

import { useEffect, useState } from "react";
import { Star, Sparkles } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetDescription,
  ResponsiveSheetBody,
} from "@/components/ui/responsive-sheet";
import { Badge } from "@/components/ui/badge";
import { SkillBars } from "@/components/skill-assessment/skill-bars";
import {
  TOWERS,
  derivePrimaryTowers,
  isFullstack,
  towerLabel,
  type SubskillMap,
  type MemberSkillRow,
} from "@/lib/memberSkills";
import { roleLabel } from "@/lib/roles";
import { fmtDateLong } from "@/lib/date-utils";

type SkillResponse = {
  member: { id: string; name: string; role: string; position: string | null; specialty: string | null };
  assessment: {
    status: "in_progress" | "completed";
    updatedAt: string;
    completedAt: string | null;
  } | null;
  skills: {
    towerKey: string;
    score: number | null;
    subskills: SubskillMap;
    cases: string | null;
    updatedAt: string;
  }[];
};

type Props = {
  memberId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SkillProfileSheet({ memberId, open, onOpenChange }: Props) {
  const [data, setData] = useState<SkillResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !memberId) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setData(null);
      try {
        const r = await fetch(`/api/members/${memberId}/skills`, {
          signal: controller.signal,
        });
        const d = r.ok ? await r.json() : null;
        setData(d);
      } catch {
        // aborted or network error — leave data as null
      } finally {
        setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [open, memberId]);

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        {loading && (
          <>
            <ResponsiveSheetTitle className="sr-only">
              Perfil de skills
            </ResponsiveSheetTitle>
            <ResponsiveSheetBody className="py-12 text-center text-sm text-muted-foreground">
              Carregando...
            </ResponsiveSheetBody>
          </>
        )}

        {!loading && data && <SheetBody data={data} />}

        {!loading && !data && (
          <>
            <ResponsiveSheetTitle className="sr-only">
              Perfil de skills
            </ResponsiveSheetTitle>
            <ResponsiveSheetBody className="py-12 text-center text-sm text-muted-foreground">
              Não foi possível carregar.
            </ResponsiveSheetBody>
          </>
        )}
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function SheetBody({ data }: { data: SkillResponse }) {
  const skillRows: MemberSkillRow[] = data.skills.map((s) => ({
    towerKey: s.towerKey,
    score: s.score,
    subskills: (s.subskills ?? {}) as SubskillMap,
    cases: s.cases,
  }));

  const hasAnswered = skillRows.length > 0;
  const { primary, secondary } = derivePrimaryTowers(skillRows);
  const fullstack = isFullstack(skillRows);
  const scores: Partial<Record<string, number | null>> = Object.fromEntries(
    skillRows.map((s) => [s.towerKey, s.score]),
  );

  const refSubskills: { towerKey: string; subskillKey: string; label: string }[] = [];
  for (const s of skillRows) {
    const tower = TOWERS.find((t) => t.key === s.towerKey);
    if (!tower) continue;
    for (const [k, state] of Object.entries(s.subskills ?? {})) {
      if (state !== "ref") continue;
      const sub = tower.subskills.find((sub) => sub.key === k);
      if (!sub) continue;
      refSubskills.push({ towerKey: s.towerKey, subskillKey: k, label: sub.label });
    }
  }

  const lastUpdated = data.assessment?.completedAt ?? data.assessment?.updatedAt ?? null;

  return (
    <>
      <ResponsiveSheetHeader className="space-y-2">
        <ResponsiveSheetTitle className="text-xl flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          {data.member.name}
        </ResponsiveSheetTitle>
        <ResponsiveSheetDescription>
          {roleLabel(data.member.position)}
        </ResponsiveSheetDescription>
      </ResponsiveSheetHeader>

      <ResponsiveSheetBody className="space-y-6">
        {!hasAnswered && (
          <div className="rounded-lg border border-dashed border-foreground/10 p-6 text-center text-sm text-muted-foreground">
            Esse membro ainda não fez a auto-avaliação.
          </div>
        )}

        {hasAnswered && (
          <>
            <div className="flex flex-wrap items-center gap-2">
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
              {data.assessment?.status === "in_progress" && (
                <Badge variant="outline" className="text-xs">Rascunho</Badge>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Torres
              </p>
              <SkillBars scores={scores} compact />
            </div>

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

            {lastUpdated && (
              <p className="text-[10px] text-muted-foreground">
                Última atualização:{" "}
                {fmtDateLong(lastUpdated)}
              </p>
            )}
          </>
        )}
      </ResponsiveSheetBody>
    </>
  );
}
