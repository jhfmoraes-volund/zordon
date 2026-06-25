"use client";

/**
 * Zordon Apps — desktop do projeto.
 *
 * Usa o shell compartilhado <AppDesktop> (dock + canvas + catálogo, mesma UX
 * no desktop e no mobile). Este componente só pluga o que é específico do
 * projeto: o catálogo filtrado por permissão, a telemetria do pool de
 * contexto (statusSlot), o dispatch de superfície (Drive/Sessions/Rituais/
 * Forge) e o diálogo de criar app. Catálogo vem do registry code-first
 * (src/lib/apps/registry.ts); instalação por projeto (ProjectApp) é fase 2.
 *
 * Gramática de superfície: app = file system; arquivo = unidade de output do
 * app (Drive: documento; Sessions: uma DS; Rituais: um ritual). A lista do
 * Drive é o padrão visual canônico (src/components/apps/app-file-list.tsx).
 */

import { useEffect, useMemo, useState } from "react";
import { Database } from "lucide-react";

import { AppDesktop } from "@/components/apps/app-desktop";
import { ProjectDriveTab } from "@/components/project-drive/drive-tab";
import { ProjectSessionsTab } from "@/components/project-sessions-tab";
import { CreateAppDialog } from "@/components/apps/create-app-dialog";
import { ProjectContractApp } from "@/components/apps/finance/project-contract-app";
import { RituaisFileView } from "@/components/apps/rituais-file-view";
import { SessionsFileView } from "@/components/apps/sessions-file-view";
import { useIsMobile } from "@/hooks/use-mobile";
import { APP_REGISTRY, type AppDef } from "@/lib/apps/registry";
import { type RitualKind } from "@/lib/access/capabilities";

import { ForgeTab } from "./forge-tab";

type PoolSource = { id: string; kind: string; title: string; createdAt: string };

type AppsTabProps = {
  projectId: string;
  projectName: string;
  canManage: boolean;
  driveFolderId: string | null;
  onConfigureFolder: () => void;
  /** Controlado pela page (sync com ?app= na URL — deep-link das ex-tabs). */
  openAppKey: string | null;
  onOpenAppKeyChange: (key: string | null) => void;
  /**
   * Modo grant_only: dock restrito a estes app keys (o usuário chegou só via
   * MemberAccessGrant). null = sem restrição (acesso normal ao projeto).
   */
  restrictToApps?: string[] | null;
  /** Modo grant_only: dentro do Rituais, só estes kinds. */
  restrictToKinds?: RitualKind[] | null;
};

export function AppsTab({
  projectId,
  projectName,
  canManage,
  driveFolderId,
  onConfigureFolder,
  openAppKey,
  onOpenAppKeyChange,
  restrictToApps,
  restrictToKinds,
}: AppsTabProps) {
  const isMobile = useIsMobile();
  const [createAppOpen, setCreateAppOpen] = useState(false);
  const [pool, setPool] = useState<PoolSource[] | null>(null);

  const apps = useMemo(
    () =>
      APP_REGISTRY.filter(
        (a) => !(a.minAccessLevel === "manager" && !canManage),
      ).filter((a) => !restrictToApps || restrictToApps.includes(a.key)),
    [canManage, restrictToApps],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/context-sources?projectId=${projectId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled && json?.sources) setPool(json.sources);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, openAppKey]);

  const poolByKind = useMemo(() => {
    if (!pool) return [];
    const counts = new Map<string, number>();
    for (const s of pool) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [pool]);

  /**
   * Superfície desktop (janela no canvas). Sessions/Rituais usam a file view
   * (gramática de arquivos); Drive/Forge re-hospedam as superfícies
   * existentes — file view deles é o próximo incremento.
   */
  function renderDesktopSurface(app: AppDef) {
    switch (app.key) {
      case "contract":
        return <ProjectContractApp projectId={projectId} />;
      case "drive":
        return (
          <ProjectDriveTab
            projectId={projectId}
            driveFolderId={driveFolderId}
            onConfigureFolder={onConfigureFolder}
          />
        );
      case "sessions":
        return (
          <SessionsFileView
            projectId={projectId}
            projectName={projectName}
            canManage={canManage}
          />
        );
      case "ceremonies":
        return (
          <RituaisFileView
            projectId={projectId}
            projectName={projectName}
            canManage={canManage}
            restrictToKinds={restrictToKinds}
          />
        );
      case "forge":
        return <ForgeTab projectId={projectId} />;
      default:
        return null;
    }
  }

  /**
   * Superfície mobile (inline no canvas, mesma janela do desktop). Rituais usa a
   * mesma file view do desktop. Sessions ainda re-hospeda a superfície original;
   * file view dele é o próximo incremento.
   */
  function renderSurface(app: AppDef) {
    if (isMobile && app.key === "sessions") {
      return (
        <ProjectSessionsTab
          projectId={projectId}
          projectName={projectName}
          canManage={canManage}
        />
      );
    }
    return renderDesktopSurface(app);
  }

  const statusSlot = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-border/60 px-1 py-1.5 font-mono text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Database className="size-3" aria-hidden />
        pool
      </span>
      {pool === null ? (
        <span>carregando…</span>
      ) : pool.length === 0 ? (
        <span>vazio — abra um app e importe contexto</span>
      ) : (
        <>
          <span className="tabular-nums">
            <span className="text-foreground">{pool.length}</span>{" "}
            {pool.length === 1 ? "insumo" : "insumos"}
          </span>
          {poolByKind.map(([kind, count]) => (
            <span key={kind} className="tabular-nums">
              {kind} <span className="text-foreground">{count}</span>
            </span>
          ))}
        </>
      )}
    </div>
  );

  return (
    <>
      <AppDesktop
        apps={apps}
        openAppKey={openAppKey}
        onOpenAppKeyChange={onOpenAppKeyChange}
        renderSurface={renderSurface}
        windowSubtitle={projectName}
        statusSlot={statusSlot}
        onCreateApp={restrictToApps ? undefined : () => setCreateAppOpen(true)}
      />
      <CreateAppDialog open={createAppOpen} onOpenChange={setCreateAppOpen} />
    </>
  );
}
