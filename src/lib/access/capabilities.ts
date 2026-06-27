/**
 * Catálogo de capabilities — SSOT em TS do que um grant (MemberAccessGrant)
 * pode destravar. Code-first de propósito: o catálogo é acoplado aos registries
 * de apps (também code-first) e os valores são referenciados por string na RLS
 * e no DAL; uma tabela no banco só adicionaria join + risco de drift, sem ganho.
 *
 * Cada capability mapeia pra UMA superfície:
 *   - kind "app"    → um app inteiro (appKey no APP_REGISTRY / OVERVIEW_APP_REGISTRY)
 *   - kind "ritual" → um ritual dentro do app "ceremonies" (ritualKind)
 *
 * Consumido por: app Acessos (lista de toggles), restrição do dock do projeto
 * (apps-tab) e filtro dentro do Rituais (rituais-file-view).
 *
 * Escopo:
 *   - "global"  → grant vale pra operação inteira (ex.: S&OP). projectId null.
 *   - "project" → grant amarrado a um projeto (ex.: Planning de um projeto).
 */

export type CapabilityKind = "app" | "ritual";
export type CapabilityScope = "global" | "project";
export type RitualKind = "release_planning" | "pm_review";

export type Capability = {
  /** Chave persistida em MemberAccessGrant.capabilityKey. */
  key: string;
  label: string;
  kind: CapabilityKind;
  scope: CapabilityScope;
  /** App que a capability destrava (rituais moram em "ceremonies"). */
  appKey: string;
  /** Só para kind "ritual": qual ritual dentro de "ceremonies". */
  ritualKind?: RitualKind;
};

export const CAPABILITIES: Capability[] = [
  // ─── Apps ────────────────────────────────────────────────────────────────
  {
    key: "app.finance",
    label: "S&OP (Finanças)",
    kind: "app",
    scope: "global",
    appKey: "finance",
  },
  {
    key: "app.ferias",
    label: "Férias & Folgas",
    kind: "app",
    scope: "global",
    appKey: "ferias",
  },
  {
    key: "app.forge",
    label: "Forge",
    kind: "app",
    scope: "project",
    appKey: "forge",
  },
  {
    key: "app.drive",
    label: "Google Drive",
    kind: "app",
    scope: "project",
    appKey: "drive",
  },
  {
    key: "app.notion",
    label: "Notion",
    kind: "app",
    scope: "project",
    appKey: "notion",
  },
  {
    key: "app.contract",
    label: "Contratos",
    kind: "app",
    scope: "project",
    appKey: "contract",
  },
  {
    key: "app.sessions",
    label: "Design Sessions",
    kind: "app",
    scope: "project",
    appKey: "sessions",
  },
  // ─── Rituais (dentro do app "ceremonies") ────────────────────────────────
  {
    key: "ritual.planning",
    label: "Planning",
    kind: "ritual",
    scope: "project",
    appKey: "ceremonies",
    ritualKind: "release_planning",
  },
  {
    key: "ritual.pm_review",
    label: "PM Review",
    kind: "ritual",
    scope: "project",
    appKey: "ceremonies",
    ritualKind: "pm_review",
  },
];

export const CAPABILITY_BY_KEY: Map<string, Capability> = new Map(
  CAPABILITIES.map((c) => [c.key, c]),
);

export function isValidCapabilityKey(key: string): boolean {
  return CAPABILITY_BY_KEY.has(key);
}

/** App keys que um conjunto de capabilities destrava (únicos). */
export function appKeysForCapabilities(capabilityKeys: string[]): string[] {
  const keys = new Set<string>();
  for (const k of capabilityKeys) {
    const cap = CAPABILITY_BY_KEY.get(k);
    if (cap) keys.add(cap.appKey);
  }
  return [...keys];
}

/** RitualKinds que um conjunto de capabilities destrava (só kind "ritual"). */
export function ritualKindsForCapabilities(
  capabilityKeys: string[],
): RitualKind[] {
  const kinds = new Set<RitualKind>();
  for (const k of capabilityKeys) {
    const cap = CAPABILITY_BY_KEY.get(k);
    if (cap?.kind === "ritual" && cap.ritualKind) kinds.add(cap.ritualKind);
  }
  return [...kinds];
}
