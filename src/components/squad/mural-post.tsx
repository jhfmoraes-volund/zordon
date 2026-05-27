"use client";

/**
 * Mural post-it — a written note pinned to the squad lounge corkboard.
 * Reuses the Design Session `StickyCard` paper variant so it reads like the
 * post-its the team already knows. Shows the note text, who wrote it, when,
 * and a kudos (👏) counter.
 *
 * Phase 1 = mock. Persistence (SquadPost + reactions) lands once the visual is
 * approved; `onKudos` is wired by the parent.
 */

import { StickyCard, type Accent } from "@/components/design-session/board";

/** Paper tones, in rotation order — one per post-it by index. */
const PAPER_ACCENTS: Extract<Accent, "sky" | "emerald" | "rose" | "amber">[] = [
  "sky",
  "emerald",
  "rose",
  "amber",
];

const AVATAR_BG: Record<(typeof PAPER_ACCENTS)[number], string> = {
  sky: "var(--accent-sky-chip)",
  emerald: "var(--accent-emerald-chip)",
  rose: "var(--accent-rose-chip)",
  amber: "var(--accent-amber-chip)",
};

export type MuralPostData = {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
  kudos: number;
  /** True when the current member already gave kudos. */
  kudosByMe: boolean;
};

function firstInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/** Lightweight "há X" — no date lib needed for the prototype. */
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

export function MuralPost({
  post,
  index,
  onKudos,
}: {
  post: MuralPostData;
  index: number;
  onKudos: (id: string) => void;
}) {
  const accent = PAPER_ACCENTS[index % PAPER_ACCENTS.length];

  return (
    <StickyCard
      accent={accent}
      variant="paper"
      collapsed={
        <div className="flex h-full flex-col gap-3">
          <p className="flex-1 whitespace-pre-wrap text-sm leading-snug">
            {post.body}
          </p>

          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold text-white"
              style={{ backgroundColor: AVATAR_BG[accent] }}
            >
              {firstInitial(post.authorName)}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs opacity-70">
              {post.authorName} · {timeAgo(post.createdAt)}
            </span>

            <button
              type="button"
              onClick={() => onKudos(post.id)}
              aria-pressed={post.kudosByMe}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition-colors ${
                post.kudosByMe
                  ? "bg-black/10 dark:bg-white/15"
                  : "hover:bg-black/5 dark:hover:bg-white/10"
              }`}
            >
              <span aria-hidden>👏</span>
              {post.kudos > 0 ? (
                <span className="tabular-nums">{post.kudos}</span>
              ) : null}
            </button>
          </div>
        </div>
      }
    />
  );
}
