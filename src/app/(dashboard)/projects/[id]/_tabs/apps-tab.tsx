"use client";

/**
 * Zordon Apps — desktop do projeto.
 *
 * Dock lateral estilo activity bar (apps instalados) + canvas. No desktop,
 * clicar num app abre a superfície como "janela" dentro do canvas (live
 * canvas — nunca sai do tab); no mobile mantém o ResponsiveSheet, que já
 * resolve bem. Catálogo vem do registry code-first (src/lib/apps/registry.ts);
 * instalação por projeto (ProjectApp) é fase 2.
 *
 * Linguagem visual: console de operação, mesma família do HUD da Forge —
 * superfícies flat com hairline, radius md, ícones monocromáticos, mono pra
 * keys/números, cor só pra identidade (dot do registry) e estado (rail do
 * app ativo). Nada de tile pastel, scale no hover ou card de marketing.
 *
 * Gramática de superfície: app = file system; arquivo = unidade de output do
 * app (Drive: documento; Sessions: uma DS; Rituais: um ritual). A lista do
 * Drive é o padrão visual canônico (src/components/apps/app-file-list.tsx).
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Database, Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/ui/responsive-sheet";
import { ProjectDriveTab } from "@/components/project-drive/drive-tab";
import { ProjectSessionsTab } from "@/components/project-sessions-tab";
import { CreateAppDialog } from "@/components/apps/create-app-dialog";
import { RituaisFileView } from "@/components/apps/rituais-file-view";
import { SessionsFileView } from "@/components/apps/sessions-file-view";
import { useIsMobile } from "@/hooks/use-mobile";
import { APP_REGISTRY, type AppDef } from "@/lib/apps/registry";
import { cn } from "@/lib/utils";

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
};

export function AppsTab({
  projectId,
  projectName,
  canManage,
  driveFolderId,
  onConfigureFolder,
  openAppKey,
  onOpenAppKeyChange,
}: AppsTabProps) {
  const isMobile = useIsMobile();
  const [createAppOpen, setCreateAppOpen] = useState(false);
  const [pool, setPool] = useState<PoolSource[] | null>(null);

  const apps = useMemo(
    () =>
      APP_REGISTRY.filter(
        (a) => !(a.minAccessLevel === "manager" && !canManage),
      ),
    [canManage],
  );
  const installedApps = apps.filter((a) => a.status === "installed");
  // Resolve contra a lista visível — URL forçada (?app=forge sem manager,
  // ?app=notion ainda available) não abre superfície.
  const openApp = openAppKey
    ? installedApps.find((a) => a.key === openAppKey)
    : undefined;

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
          />
        );
      case "forge":
        return <ForgeTab projectId={projectId} />;
      default:
        return null;
    }
  }

  /**
   * Superfície mobile (dentro do ResponsiveSheet). Rituais agora usa a mesma
   * file view do desktop (RituaisFileView, via renderDesktopSurface) — superfície
   * única, sem o componente antigo de duas colunas. Sessions ainda re-hospeda a
   * superfície original; file view dele é o próximo incremento.
   */
  function renderMobileSurface(app: AppDef) {
    if (app.key === "sessions") {
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

  return (
    <div className="flex gap-3">
      {/* ─── Dock (activity bar) ──────────────────────────────────────── */}
      <aside className="flex w-16 shrink-0 flex-col items-center gap-1 self-start rounded-md border p-1.5">
        {installedApps.map((app) => {
          const active = openAppKey === app.key;
          return (
            <button
              key={app.key}
              type="button"
              onClick={() => onOpenAppKeyChange(app.key)}
              title={`${app.name} — ${app.tagline}`}
              aria-label={app.name}
              className={cn(
                "relative flex w-full flex-col items-center gap-1 rounded-md px-1 py-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active && "bg-muted text-foreground",
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary"
                />
              )}
              <app.icon className="size-[22px]" />
              <span className="line-clamp-2 text-center text-[10px] leading-tight">
                {app.name}
              </span>
            </button>
          );
        })}
        <div className="my-0.5 h-px w-8 bg-border" />
        <button
          type="button"
          onClick={() => setCreateAppOpen(true)}
          title="Criar app com Volund OS"
          aria-label="Criar app"
          className="flex w-full flex-col items-center gap-1 rounded-md border border-dashed px-1 py-1.5 text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-[22px]" />
          <span className="text-center text-[10px] leading-tight">Novo</span>
        </button>
      </aside>

      {/* ─── Canvas ───────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 space-y-3">
        {/* Status bar — telemetria do pool de contexto, sempre visível */}
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

        {openApp && !isMobile ? (
          /* Janela do app — live canvas, sem sair do tab */
          <div className="overflow-hidden rounded-md border">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
              <span
                aria-hidden
                className={cn("size-1.5 shrink-0 rounded-full", openApp.dot)}
              />
              <openApp.icon className="size-4 shrink-0 text-muted-foreground" />
              <p className="min-w-0 flex-1 truncate text-sm">
                <span className="font-mono font-medium">{openApp.key}</span>
                <span className="ml-1.5 text-muted-foreground">
                  · {projectName}
                </span>
              </p>
              <button
                type="button"
                title="Fechar app"
                aria-label="Fechar app"
                onClick={() => onOpenAppKeyChange(null)}
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="p-4">{renderDesktopSurface(openApp)}</div>
          </div>
        ) : (
          /* Catálogo — registry rows, gramática de arquivos */
          <div>
            <p className="px-1 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Catálogo · {apps.length}
            </p>
            <div className="divide-y divide-border/60 rounded-md border">
              {apps.map((app) => {
                const isInstalled = app.status === "installed";
                return (
                  <div
                    key={app.key}
                    role={isInstalled ? "button" : undefined}
                    tabIndex={isInstalled ? 0 : undefined}
                    title={app.description}
                    onClick={
                      isInstalled
                        ? () => onOpenAppKeyChange(app.key)
                        : undefined
                    }
                    onKeyDown={(e) => {
                      if (isInstalled && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        onOpenAppKeyChange(app.key);
                      }
                    }}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5",
                      isInstalled
                        ? "cursor-pointer transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        : "opacity-55",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn("size-1.5 shrink-0 rounded-full", app.dot)}
                    />
                    <app.icon className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {app.name}
                        </p>
                        {app.minAccessLevel && (
                          <Badge variant="outline" className="text-[10px]">
                            {app.minAccessLevel}+
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {app.tagline}
                      </p>
                    </div>
                    <div className="hidden shrink-0 items-center gap-3 font-mono text-[10px] text-muted-foreground md:flex">
                      {(app.produces.context ?? []).length > 0 && (
                        <span>
                          escreve {(app.produces.context ?? []).join(" ")}
                        </span>
                      )}
                      {(app.produces.artifacts ?? []).length > 0 && (
                        <span>
                          gera {(app.produces.artifacts ?? []).join(" ")}
                        </span>
                      )}
                    </div>
                    {isInstalled ? (
                      <ChevronRight
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                    ) : (
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        em breve
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <CreateAppDialog open={createAppOpen} onOpenChange={setCreateAppOpen} />

      {/* ─── Sheet host (só mobile) ───────────────────────────────────── */}
      {isMobile && (
        <ResponsiveSheet
          open={!!openApp}
          onOpenChange={(open) => {
            if (!open) onOpenAppKeyChange(null);
          }}
        >
          {openApp && (
            <ResponsiveSheetContent size={openApp.window}>
              <ResponsiveSheetHeader>
                <ResponsiveSheetTitle className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn("size-1.5 rounded-full", openApp.dot)}
                  />
                  <openApp.icon className="size-4 text-muted-foreground" />
                  {openApp.name}
                  <span className="font-normal text-muted-foreground">
                    · {projectName}
                  </span>
                </ResponsiveSheetTitle>
              </ResponsiveSheetHeader>
              <ResponsiveSheetBody>{renderMobileSurface(openApp)}</ResponsiveSheetBody>
            </ResponsiveSheetContent>
          )}
        </ResponsiveSheet>
      )}
    </div>
  );
}
