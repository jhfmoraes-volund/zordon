/**
 * Source of truth for **two independent axes**:
 *
 *  1. **Access level** (`AccessLevel`): what a user can do on the platform —
 *     `guest` < `builder` < `manager` < `admin`. Lives in
 *     `auth.users.app_metadata.access_level` and drives all authorization
 *     (`is_admin()`, `is_manager()`, `hasMinAccessLevel()`).
 *
 *  2. **Position** (`Position`): the user's job title — Principal Engineer,
 *     PM, CEO, etc. Lives in `Member.position` (renamed from `Member.role`).
 *     Display-only; never used for authorization.
 *
 * Splitting these lets us promote a Principal Engineer to admin without
 * lying about their job, and vice-versa.
 *
 * The legacy `role` (single string mixing both) is kept temporarily as
 * `@deprecated`. During the migration window, helpers fall back to deriving
 * `accessLevel` from `role` via `mapPositionToAccessLevel()`.
 */

// ─── Access Level (authz axis) ───────────────────────────

export type AccessLevel = "guest" | "builder" | "manager" | "admin";

export const ACCESS_LEVELS: Record<AccessLevel, number> = {
  guest: 0,
  builder: 1,
  manager: 2,
  admin: 3,
};

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  guest: "Guest",
  builder: "Builder",
  manager: "Manager",
  admin: "Admin",
};

/** Access levels in ascending order (excludes guest by default for member forms). */
export const MEMBER_ACCESS_LEVELS: AccessLevel[] = ["builder", "manager", "admin"];

// ─── Position (job title axis) ───────────────────────────

export type Position =
  | "ceo"
  | "cro"
  | "head-ops"
  | "pm"
  | "principal-engineer"
  | "product-builder";

export const POSITIONS: Position[] = [
  "ceo",
  "cro",
  "head-ops",
  "pm",
  "principal-engineer",
  "product-builder",
];

export const POSITION_LABELS: Record<Position, string> = {
  ceo: "CEO",
  cro: "CRO",
  "head-ops": "Head Ops",
  pm: "PM",
  "principal-engineer": "Principal Engineer",
  "product-builder": "Product Builder",
};

/**
 * Positions allowed to be the responsible PM of a project. Single source of
 * truth for the PM dropdown filter (and its inverse, the "allocated members"
 * list) — keep UI filters pointing here instead of hard-coding `=== "pm"`.
 */
export const PM_ELIGIBLE_POSITIONS: Position[] = ["pm", "head-ops"];

/** Whether a member's position makes them eligible to be a project's PM. */
export function isPmEligible(position: string | null | undefined): boolean {
  return PM_ELIGIBLE_POSITIONS.includes(position as Position);
}

// ─── Legacy `Role` (cargo+access merged) ─────────────────
// @deprecated — use AccessLevel for authz, Position for job title.

/** @deprecated use `ACCESS_LEVELS` (for authz) or `POSITIONS` (for job titles). */
export const ROLE_LEVELS = {
  ceo: 3,
  cro: 3,
  "head-ops": 3,
  pm: 2,
  "principal-engineer": 1,
  "product-builder": 1,
  guest: 0,
} as const;

/** @deprecated use `Position` or `AccessLevel`. */
export type Role = keyof typeof ROLE_LEVELS;

export const GUEST = 0;
export const BUILDER = 1;
export const MANAGER = 2;
export const ADMIN = 3;

/** @deprecated use `POSITION_LABELS` or `ACCESS_LEVEL_LABELS`. */
export const ROLE_LABELS: Record<Role, string> = {
  ceo: "CEO",
  cro: "CRO",
  "head-ops": "Head Ops",
  pm: "PM",
  "principal-engineer": "Principal Engineer",
  "product-builder": "Product Builder",
  guest: "Guest",
};

/** @deprecated use `POSITIONS`. */
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

// ─── Helpers (new — preferred) ───────────────────────────

/**
 * Backfill mapping: turns a legacy `Role`/`Position` into its corresponding
 * `AccessLevel`. Used as fallback while JWTs still lack `access_level`.
 *
 *   ceo|cro|head-ops → admin
 *   pm               → manager
 *   principal-eng… / product-builder → builder
 *   guest / unknown  → guest
 */
export function mapPositionToAccessLevel(
  positionOrRole: string | null | undefined,
): AccessLevel {
  switch (positionOrRole) {
    case "ceo":
    case "cro":
    case "head-ops":
      return "admin";
    case "pm":
      return "manager";
    case "principal-engineer":
    case "product-builder":
      return "builder";
    default:
      return "guest";
  }
}

/**
 * Resolve the effective access level given JWT app_metadata fields. Reads
 * `access_level` first; falls back to deriving from legacy `role`. Returns
 * `guest` when both are missing.
 */
export function resolveAccessLevel(
  accessLevel: string | null | undefined,
  legacyRole?: string | null | undefined,
): AccessLevel {
  if (accessLevel && accessLevel in ACCESS_LEVELS) {
    return accessLevel as AccessLevel;
  }
  return mapPositionToAccessLevel(legacyRole);
}

/** True iff `level` is at or above `min`. */
export function hasMinAccessLevel(
  level: AccessLevel | null | undefined,
  min: AccessLevel,
): boolean {
  if (!level) return false;
  return ACCESS_LEVELS[level] >= ACCESS_LEVELS[min];
}

/** Human-friendly position label. Falls back to raw string. */
export function positionLabel(position: string | null | undefined): string {
  if (!position) return "—";
  return POSITION_LABELS[position as Position] ?? position;
}

/** Human-friendly access level label. Falls back to raw string. */
export function accessLevelLabel(level: string | null | undefined): string {
  if (!level) return "—";
  return ACCESS_LEVEL_LABELS[level as AccessLevel] ?? level;
}

// ─── Helpers (legacy — deprecated) ───────────────────────

/** @deprecated use `ACCESS_LEVELS` directly or `hasMinAccessLevel`. */
export function getRoleLevel(role: string | null | undefined): number {
  if (!role) return 0;
  return ROLE_LEVELS[role as Role] ?? 0;
}

/** @deprecated use `hasMinAccessLevel(level, min)` instead. */
export function hasMinLevel(
  role: string | null | undefined,
  min: number,
): boolean {
  return getRoleLevel(role) >= min;
}

/** @deprecated use `positionLabel` (cargo) or `accessLevelLabel` (access). */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return "—";
  return ROLE_LABELS[role as Role] ?? role;
}

/** @deprecated check `accessLevel === 'admin'` etc. directly. */
export function roleNamesAtLevel(minLevel: number): string[] {
  return (Object.entries(ROLE_LEVELS) as [Role, number][])
    .filter(([, level]) => level >= minLevel)
    .map(([role]) => role);
}

/** @deprecated check `accessLevel === 'admin'` directly. */
export const ADMIN_ROLE_NAMES = roleNamesAtLevel(ADMIN);
