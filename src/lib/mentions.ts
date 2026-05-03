// Pure mention helpers — usable from both client (composer preview) and server
// (validation in routes). No "server-only" import here.

export type MentionMember = {
  id: string;
  name: string | null;
};

export type MentionableMember = MentionMember & {
  slug: string;
};

export type ParseMentionsResult = {
  ids: string[];
  slugs: string[];
};

const MENTION_REGEX = /(?:^|[\s(\[{>"'.,;:!?])@([a-z0-9-]+)/g;

function baseSlug(name: string | null): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    // strip combining diacritics
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Build the unique slug for each member, given the project membership.
 *
 * Disambiguation: members whose base slug collides get suffixed with the first
 * 4 chars of their uuid. Resolution is deterministic — same input → same slug.
 *
 * Slugs are derived (never stored). Renaming a member updates slugs at next
 * render; old comments still resolve their old `@slug` to the same id only if
 * the slug still derives identically. That's intentional: edits propagate.
 */
export function buildMentionableMembers(
  members: MentionMember[],
): MentionableMember[] {
  const groups = new Map<string, MentionMember[]>();
  for (const m of members) {
    const fallback = `m-${m.id.slice(0, 8)}`;
    const slug = baseSlug(m.name) || fallback;
    if (!groups.has(slug)) groups.set(slug, []);
    groups.get(slug)!.push(m);
  }
  const out: MentionableMember[] = [];
  for (const [slug, list] of groups) {
    if (list.length === 1) {
      out.push({ ...list[0], slug });
    } else {
      for (const m of list) {
        out.push({ ...m, slug: `${slug}-${m.id.slice(0, 4)}` });
      }
    }
  }
  return out;
}

/**
 * Resolve `@<slug>` mentions in a body to member ids.
 *
 * Matches happen at start-of-string or after whitespace/punctuation. Code
 * fences and inline code are NOT excluded — keeping it simple. Documenting:
 * `@foo` inside backticks still mentions; users can avoid by editing.
 *
 * Unknown slugs are silently ignored. Each resolved id appears once even if
 * mentioned multiple times.
 */
export function parseMentions(
  body: string,
  members: MentionMember[],
): ParseMentionsResult {
  const mentionable = buildMentionableMembers(members);
  const bySlug = new Map(mentionable.map((m) => [m.slug, m]));

  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const match of body.matchAll(MENTION_REGEX)) {
    const slug = match[1];
    const m = bySlug.get(slug);
    if (!m) continue;
    ids.add(m.id);
    slugs.add(slug);
  }
  return { ids: [...ids], slugs: [...slugs] };
}
