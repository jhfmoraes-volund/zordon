"use client";

/**
 * Área de Apps do Overview — mesmo conceito de UI dos apps de projeto
 * (dock + canvas + catálogo via <AppDesktop>), com registry e superfícies
 * próprias (org-level). openAppKey sincroniza com ?app= na URL.
 */

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { AppDesktop } from "@/components/apps/app-desktop";
import { FinanceApp } from "@/components/apps/finance/finance-app";
import { AccessApp } from "@/components/apps/access/access-app";
import { OVERVIEW_APP_REGISTRY } from "@/lib/apps/overview-registry";
import { type AppDef } from "@/lib/apps/registry";
import { hasMinAccessLevel, type AccessLevel } from "@/lib/roles";

export function OverviewAppsDesktop({
  accessLevel,
}: {
  accessLevel: AccessLevel;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const openAppKey = searchParams.get("app");
  // Subtítulo da janela = projeto aberto no Finanças (reportado pelo FinanceApp).
  const [financeProject, setFinanceProject] = useState<string | null>(null);

  const apps = OVERVIEW_APP_REGISTRY.filter(
    (a) => !a.minAccessLevel || hasMinAccessLevel(accessLevel, a.minAccessLevel),
  );

  const onOpenAppKeyChange = useCallback(
    (key: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", "apps");
      if (key) params.set("app", key);
      else params.delete("app");
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  function renderSurface(app: AppDef) {
    switch (app.key) {
      case "finance":
        return (
          <FinanceApp
            onSelectedProjectChange={setFinanceProject}
            initialProjectId={searchParams.get("fp")}
          />
        );
      case "access":
        return <AccessApp />;
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
      windowSubtitle={financeProject ?? "Overview"}
    />
  );
}
