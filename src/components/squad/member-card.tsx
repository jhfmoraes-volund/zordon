"use client";

/**
 * Member card for the squad lounge — vertical, avatar-centered. Five at a row
 * on desktop. Surfaces, per member: FP capacity, project chips, task count in
 * the active sprint, and the join date ("desde").
 *
 * Phase 1: avatar is a Slack-style colored initial (no photo column yet).
 */

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PixelHud } from "@/components/ui/pixel-bar";
import { fmtDateLong } from "@/lib/date-utils";

/** Avatar background rotates by index so a row of cards reads varied. */
const AVATAR_BG = [
  "var(--accent-sky-chip)",
  "var(--accent-emerald-chip)",
  "var(--accent-rose-chip)",
  "var(--accent-amber-chip)",
  "var(--accent-violet-chip)",
];

export type SquadMemberCard = {
  id: string;
  name: string;
  position: string | null;
  fpCapacity: number;
  createdAt: string | null;
  onboardedAt: string | null;
  projects: { id: string; name: string }[];
  sprintTaskCount: number;
};

function firstInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/** Inline stat: big value + small label, centered. */
function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-lg font-bold leading-none tabular-nums">{value}</span>
      <PixelHud size="xs" tone="muted" className="mt-1">
        {label}
      </PixelHud>
    </div>
  );
}

const MAX_CHIPS = 2;

export function MemberCard({
  member,
  index,
}: {
  member: SquadMemberCard;
  index: number;
}) {
  const avatarBg = AVATAR_BG[index % AVATAR_BG.length];
  const joined = member.onboardedAt ?? member.createdAt;
  const shownProjects = member.projects.slice(0, MAX_CHIPS);
  const overflow = member.projects.length - shownProjects.length;

  return (
    <Link
      href={`/members/${member.id}`}
      className="flex flex-col items-center rounded-lg border bg-background/40 p-4 text-center transition-colors hover:border-foreground/30 hover:bg-background/70"
    >
      {/* Avatar + name */}
      <span
        aria-hidden
        className="grid size-16 place-items-center rounded-2xl text-3xl font-bold text-white shadow-sm"
        style={{ backgroundColor: avatarBg }}
      >
        {firstInitial(member.name)}
      </span>
      <p className="mt-2 line-clamp-1 font-semibold leading-tight">
        {member.name}
      </p>
      {member.position ? (
        <PixelHud size="xs" tone="muted" className="mt-0.5">
          {member.position}
        </PixelHud>
      ) : null}

      {/* FP + tasks in sprint */}
      <div className="mt-3 flex w-full items-start justify-center gap-5">
        <Stat value={member.fpCapacity} label="FP" />
        <Stat value={member.sprintTaskCount} label="tasks/sprint" />
      </div>

      {/* Project chips */}
      <div className="mt-3 flex min-h-[22px] flex-wrap justify-center gap-1">
        {shownProjects.map((p) => (
          <Badge key={p.id} variant="secondary" className="max-w-full truncate text-[10px]">
            {p.name}
          </Badge>
        ))}
        {overflow > 0 ? (
          <Badge variant="outline" className="text-[10px]">
            +{overflow}
          </Badge>
        ) : null}
        {member.projects.length === 0 ? (
          <span className="text-[10px] text-muted-foreground">Sem projetos</span>
        ) : null}
      </div>

      {/* Joined */}
      <p className="mt-3 text-[10px] text-muted-foreground">
        desde {fmtDateLong(joined)}
      </p>
    </Link>
  );
}
