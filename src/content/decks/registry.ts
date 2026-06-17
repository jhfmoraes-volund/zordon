/**
 * Registry of Volund content decks.
 *
 * Each entry is a deck imported from Claude Design (or authored in-house)
 * and rendered via <DeckStage>. The metadata here drives the /workflow
 * library index. The actual slides live alongside in
 * `src/content/decks/<slug>/index.tsx` and are dynamically imported by
 * the [slug] route to keep the library page light.
 *
 * To add a new deck:
 *  1. Drop slides into src/content/decks/<slug>/slides/*.tsx
 *  2. Export `<slug>Slides(): React.ReactNode[]` from <slug>/index.tsx
 *  3. Append a DeckMeta entry below.
 */

import type { AccessLevel } from "@/lib/roles";

export type DeckKind = "deck" | "guide";

export type DeckMeta = {
  slug: string;
  title: string;
  /** short uppercased label, e.g. "PLAYBOOK", "GUIA", "INOVAÇÃO" */
  eyebrow: string;
  /** one-sentence description for the library card */
  description: string;
  /** display in the library list */
  kind: DeckKind;
  /** total slides — shown on the card */
  slideCount: number;
  /** ISO date (yyyy-mm-dd) — for sorting + last-updated label */
  updatedAt: string;
  /** thematic tags surfaced as pills on the card */
  tags: string[];
  /**
   * Minimum access level required to see/open this deck. Omit for "everyone
   * who can reach /workflow" (builder+, since guests are blocked at proxy).
   * Enforced in BOTH the library page (hides the card) and the [slug] route
   * (notFound). `"manager"` ⇒ PMs + admins only.
   */
  minAccessLevel?: AccessLevel;
};

export const decks: DeckMeta[] = [
  {
    slug: "operacao-volund",
    title: "Operação Volund",
    eyebrow: "PLAYBOOK · OPERAÇÃO",
    description:
      "Três fases, um time, um cronograma claro. Da imersão com o cliente à operação assistida em produção — o desenho completo da nossa esteira.",
    kind: "deck",
    slideCount: 10,
    updatedAt: "2026-05-19",
    tags: ["Operação", "Esteira", "FORGE"],
  },
  {
    slug: "rituais-o-combinado",
    title: "Rituais do Projeto",
    eyebrow: "GUIA · RITUAIS · PM & ADMIN",
    description:
      "O combinado de como operamos os rituais — Sprint Planning, PM Review e Release Planning. Por que existem, quem faz o quê, e por que manter cada um em dia é parte do trabalho.",
    kind: "guide",
    slideCount: 10,
    updatedAt: "2026-06-17",
    tags: ["Rituais", "PM", "Combinado"],
    minAccessLevel: "manager",
  },
];

export function getDeck(slug: string): DeckMeta | undefined {
  return decks.find((d) => d.slug === slug);
}
