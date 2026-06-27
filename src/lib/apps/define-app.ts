/**
 * App SDK — contrato de um Zordon App.
 *
 * Um app deixa de ser "só metadata" (AppDef) e passa a se auto-descrever:
 * metadata + escopo + a própria Surface (o que renderiza na janela do canvas).
 * Isso mata o `switch (app.key)` que antes vivia distante, em cada desktop:
 * o registry vira um barrel de defs e o <AppHost> renderiza `app.Surface(ctx)`.
 *
 * Criar app = 1 arquivo auto-contido (use a skill /new-app):
 *   src/lib/apps/defs/<scope>/<key>.tsx  →  export const fooApp = defineApp({...})
 *
 * A Surface recebe um `ctx` tipado pelo escopo (overview/project/client) — os
 * props certos, type-safe, sem props soltos. O ctx carrega o que toda Surface
 * precisa (deep-link, subtítulo da janela, mobile) + os campos do escopo.
 */
import { type ReactNode } from "react";

import { type RitualKind } from "@/lib/access/capabilities";
import { type AppDef } from "@/lib/apps/registry";
import { type AccessLevel } from "@/lib/roles";

export type AppScope = "overview" | "project" | "client";

/**
 * Subconjunto read-only de URLSearchParams que as Surfaces usam pra ler
 * deep-link (?fp=, ?app=...). Desacopla do tipo ReadonlyURLSearchParams do Next
 * — useSearchParams() e URLSearchParams ambos satisfazem.
 */
export type AppSearchParams = Pick<URLSearchParams, "get" | "getAll" | "has">;

/** Campos que o <AppHost> injeta em toda Surface, independente do escopo. */
export type AppContextBase = {
  scope: AppScope;
  searchParams: AppSearchParams;
  /** Reporta o subtítulo do chrome da janela (ex.: projeto aberto no S&OP). */
  setWindowSubtitle: (subtitle: string | null) => void;
  isMobile: boolean;
};

export type OverviewAppContext = AppContextBase & {
  scope: "overview";
  accessLevel: AccessLevel;
};

export type ProjectAppContext = AppContextBase & {
  scope: "project";
  projectId: string;
  projectName: string;
  canManage: boolean;
  driveFolderId: string | null;
  onConfigureFolder: () => void;
  /** grant_only: dentro do Rituais, só estes kinds (null = sem restrição). */
  restrictToKinds: RitualKind[] | null;
};

export type ClientAppContext = AppContextBase & {
  scope: "client";
  clientId: string;
  accessLevel: AccessLevel;
};

/** Mapa escopo → ctx, pra indexar `AppContextFor[S]` no genérico do host. */
export type AppContextFor = {
  overview: OverviewAppContext;
  project: ProjectAppContext;
  client: ClientAppContext;
};

/** App auto-contido: metadata (AppDef) + escopo + Surface tipada pelo escopo. */
export type AppModule<S extends AppScope = AppScope> = AppDef & {
  scope: S;
  /** Render da superfície na janela do canvas. Recebe o ctx do escopo. */
  Surface: (ctx: AppContextFor[S]) => ReactNode;
};

/**
 * Declara um app. Aplica os defaults das convenções (`produces` vazio — só
 * escopo de projeto emite contexto; `status` installed). O escopo é inferido
 * do campo `scope`, então `Surface` já vem com o ctx certo.
 */
export function defineApp<S extends AppScope>(
  app: Omit<AppModule<S>, "produces" | "status"> &
    Partial<Pick<AppDef, "produces" | "status">>,
): AppModule<S> {
  return { produces: {}, status: "installed", ...app } as AppModule<S>;
}
