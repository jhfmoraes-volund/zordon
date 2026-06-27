"use client";

/**
 * AppHost — host genérico dos Zordon Apps (camada do App SDK).
 *
 * Fica entre o registry (barrel de defs) e o <AppDesktop> (shell visual, que
 * segue intocado). Absorve a lógica que antes era copiada nos 3 desktops
 * (overview/project/client): filtro de visibilidade, subtítulo dinâmico da
 * janela, montagem do ctx, e o dispatch de superfície — que agora é só
 * `app.Surface(ctx)`, sem `switch`.
 *
 * Controlled: recebe openAppKey/onOpenAppKeyChange. Escopos self-owned
 * (overview/client) usam o hook useAppUrlSync abaixo; o project recebe os da
 * page (deep-link das ex-tabs). O predicado `access` é injetado por escopo
 * (overview/client filtram por access level; project por canManage).
 */

import { useCallback, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { AppDesktop } from "@/components/apps/app-desktop";
import {
  type AppContextBase,
  type AppContextFor,
  type AppModule,
  type AppScope,
} from "@/lib/apps/define-app";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * URL sync default dos escopos self-owned. Sincroniza ?app= com a navegação.
 * forceTabApps mantém ?tab=apps (Overview vive dentro de uma tab).
 */
export function useAppUrlSync({
  forceTabApps = false,
}: { forceTabApps?: boolean } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openAppKey = searchParams.get("app");

  const onOpenAppKeyChange = useCallback(
    (key: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (forceTabApps) params.set("tab", "apps");
      if (key) params.set("app", key);
      else params.delete("app");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, forceTabApps],
  );

  return { openAppKey, onOpenAppKeyChange };
}

type AppHostProps<S extends AppScope> = {
  scope: S;
  /** Catálogo do escopo (defs). */
  apps: AppModule<S>[];
  openAppKey: string | null;
  onOpenAppKeyChange: (key: string | null) => void;
  /** Visibilidade por app (default: tudo visível). */
  access?: (app: AppModule<S>) => boolean;
  /** grant_only (project): dock confinado a estes keys (null = sem restrição). */
  restrictToApps?: string[] | null;
  /** Campos de ctx do escopo (o host injeta os da base). */
  scopeContext: Omit<AppContextFor[S], keyof AppContextBase>;
  /** Subtítulo da janela quando nenhuma Surface reportou um (ex.: "Overview"). */
  defaultSubtitle?: string;
  statusSlot?: ReactNode;
  onCreateApp?: () => void;
  catalogLabel?: string;
};

export function AppHost<S extends AppScope>({
  scope,
  apps,
  openAppKey,
  onOpenAppKeyChange,
  access,
  restrictToApps,
  scopeContext,
  defaultSubtitle,
  statusSlot,
  onCreateApp,
  catalogLabel,
}: AppHostProps<S>) {
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();

  // Subtítulo dinâmico da janela (ex.: projeto aberto no S&OP). Reseta ao
  // trocar de app (durante o render, antes da nova Surface montar) — a Surface
  // recém-montada reporta o seu via ctx.setWindowSubtitle, se tiver.
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [prevKey, setPrevKey] = useState(openAppKey);
  if (openAppKey !== prevKey) {
    setPrevKey(openAppKey);
    setSubtitle(null);
  }

  const visible = apps
    .filter((a) => (access ? access(a) : true))
    .filter((a) => !restrictToApps || restrictToApps.includes(a.key));

  // base + campos do escopo = o ctx do escopo. O TS não consegue provar a
  // união indexada por genérico (AppContextFor[S]), daí o cast via unknown —
  // confinado a este ponto; as Surfaces recebem o ctx já tipado.
  const ctx = {
    scope,
    ...scopeContext,
    searchParams,
    setWindowSubtitle: setSubtitle,
    isMobile,
  } as unknown as AppContextFor[S];

  return (
    <AppDesktop
      apps={visible}
      openAppKey={openAppKey}
      onOpenAppKeyChange={onOpenAppKeyChange}
      renderSurface={(app) => (app as AppModule<S>).Surface(ctx)}
      windowSubtitle={subtitle ?? defaultSubtitle}
      statusSlot={statusSlot}
      onCreateApp={onCreateApp}
      catalogLabel={catalogLabel}
    />
  );
}
