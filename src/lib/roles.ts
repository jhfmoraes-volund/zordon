/**
 * Single source of truth for role hierarchy, specialties, and labels.
 *
 * Level semantics:
 *   3 — Admin:   full access, can impersonate.
 *   2 — Manager: full read/write access to management routes, cannot impersonate.
 *   1 — Builder: restricted to Profile, Projects, Clients, Workflow.
 *
 * For authorization, prefer `hasMinLevel(role, MANAGER)` over hardcoding
 * role names like `["head-ops", "ceo"]`.
 */

// ─── Roles ───────────────────────────────────────────────

export const ROLE_LEVELS = {
  ceo: 3,
  "head-ops": 3,
  pm: 2,
  "principal-engineer": 1,
  "product-builder": 1,
} as const;

export type Role = keyof typeof ROLE_LEVELS;

export const BUILDER = 1;
export const MANAGER = 2;
export const ADMIN = 3;

export const ROLE_LABELS: Record<Role, string> = {
  ceo: "CEO",
  "head-ops": "Head Ops",
  pm: "PM",
  "principal-engineer": "Principal Engineer",
  "product-builder": "Product Builder",
};

/** All role keys in display order. */
export const ROLES = Object.keys(ROLE_LEVELS) as Role[];

// ─── Specialties ─────────────────────────────────────────

export const SPECIALTIES = [
  "fullstack",
  "ux-ui",
  "backend",
  "qa",
  "infra",
  "security",
] as const;

export type Specialty = (typeof SPECIALTIES)[number];

export const SPECIALTY_LABELS: Record<Specialty, string> = {
  fullstack: "Fullstack",
  "ux-ui": "UX / UI",
  backend: "Backend",
  qa: "QA",
  infra: "Infra",
  security: "Security",
};

/** Human-friendly label for a specialty; falls back to the raw string. */
export function specialtyLabel(specialty: string | null | undefined): string {
  if (!specialty) return "—";
  return SPECIALTY_LABELS[specialty as Specialty] ?? specialty;
}

// ─── Helpers ─────────────────────────────────────────────

/** Returns the numeric level for a role. Unknown/null roles → 0. */
export function getRoleLevel(role: string | null | undefined): number {
  if (!role) return 0;
  return ROLE_LEVELS[role as Role] ?? 0;
}

/** True iff the role meets or exceeds the given minimum level. */
export function hasMinLevel(
  role: string | null | undefined,
  min: number,
): boolean {
  return getRoleLevel(role) >= min;
}

/** Human-friendly label for a role; falls back to the raw string. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return ROLE_LABELS[role as Role] ?? role;
}

/**
 * All role names at or above the given level. Use this when a Route Handler
 * needs an explicit role list (e.g., `requireRole(adminRoleNames())`).
 */
export function roleNamesAtLevel(minLevel: number): string[] {
  return (Object.entries(ROLE_LEVELS) as [Role, number][])
    .filter(([, level]) => level >= minLevel)
    .map(([role]) => role);
}

/** Convenience: all role names at ADMIN level (head-ops, ceo). */
export const ADMIN_ROLE_NAMES = roleNamesAtLevel(ADMIN);
