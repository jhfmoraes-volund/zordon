"use client";

/**
 * Área de Apps do Overview — sobre o App SDK. O catálogo vem do barrel
 * (OVERVIEW_APP_REGISTRY) e o <AppHost> resolve URL sync (?app=), filtro de
 * acesso e o dispatch de superfície (cada app traz a sua Surface). O subtítulo
 * dinâmico do S&OP (projeto aberto) flui via ctx.setWindowSubtitle.
 */

import { AppHost, useAppUrlSync } from "@/components/apps/app-host";
import { OVERVIEW_APP_REGISTRY } from "@/lib/apps/overview-registry";
import { hasMinAccessLevel, type AccessLevel } from "@/lib/roles";

export function OverviewAppsDesktop({
  accessLevel,
}: {
  accessLevel: AccessLevel;
}) {
  const { openAppKey, onOpenAppKeyChange } = useAppUrlSync({
    forceTabApps: true,
  });

  return (
    <AppHost
      scope="overview"
      apps={OVERVIEW_APP_REGISTRY}
      openAppKey={openAppKey}
      onOpenAppKeyChange={onOpenAppKeyChange}
      access={(a) =>
        !a.minAccessLevel || hasMinAccessLevel(accessLevel, a.minAccessLevel)
      }
      scopeContext={{ accessLevel }}
      defaultSubtitle="Overview"
    />
  );
}
