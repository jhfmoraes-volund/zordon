"use client";

/**
 * Área de Apps do cliente — mesmo conceito de UI dos apps de projeto e do
 * Overview (dock + canvas + catálogo via <AppDesktop>), com registry e
 * superfícies próprias (client-level): Inovação (Oportunidades) e CSAT.
 *
 * openAppKey sincroniza com ?app= na URL (deep-link das ex-rotas
 * /opportunities e /csat, agora redirects). Sem ?app= o AppDesktop cai no
 * catálogo (D3 — launcher).
 *
 * Visibilidade por nível de acesso refiltrada aqui (espelha o overview); como
 * ambos os apps não declaram minAccessLevel, o filtro é um no-op hoje — fica
 * pronto para apps futuros com gate.
 */

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { AppDesktop } from "@/components/apps/app-desktop";
import { OpportunitiesApp } from "@/components/opportunities/opportunities-app";
import { CsatApp } from "@/components/clients/csat-app";
import { CLIENT_APP_REGISTRY } from "@/lib/apps/client-registry";
import { type AppDef } from "@/lib/apps/registry";
import { hasMinAccessLevel } from "@/lib/roles";
import { useAuth } from "@/contexts/auth-context";

export function ClientAppsDesktop({ clientId }: { clientId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { effectiveAccessLevel } = useAuth();
  const openAppKey = searchParams.get("app");

  const apps = CLIENT_APP_REGISTRY.filter(
    (a) =>
      !a.minAccessLevel || hasMinAccessLevel(effectiveAccessLevel, a.minAccessLevel),
  );

  const onOpenAppKeyChange = useCallback(
    (key: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (key) params.set("app", key);
      else params.delete("app");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  function renderSurface(app: AppDef) {
    switch (app.key) {
      case "opportunities":
        return <OpportunitiesApp clientId={clientId} />;
      case "csat":
        return <CsatApp clientId={clientId} />;
      default:
        return null;
    }
  }

  return (
    <AppDesktop
      apps={apps}
      openAppKey={openAppKey}
      onOpenAppKeyChange={onOpenAppKeyChange}
      renderSurface={renderSurface}
      windowSubtitle="Cliente"
    />
  );
}
