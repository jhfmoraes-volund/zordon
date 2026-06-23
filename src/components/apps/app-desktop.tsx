"use client";

/**
 * AppDesktop — shell visual compartilhado dos Zordon Apps.
 *
 * Dock lateral (activity bar) com os apps instalados + canvas. Clicar num app
 * abre a superfície como "janela" dentro do canvas (live canvas — nunca sai do
 * tab); o X volta pro catálogo. Mesma UX no desktop e no mobile.
 *
 * Linguagem visual: console de operação (família do HUD da Forge) — superfícies
 * flat com hairline, radius md, ícones monocromáticos, mono pra keys/números,
 * cor só pra identidade (dot do registry) e estado (rail do app ativo).
 *
 * É puramente apresentacional: o catálogo (`apps`), o estado aberto
 * (`openAppKey`) e o render de cada superfície (`renderSurface`) vêm de fora.
 * Usado pelo tab de Apps do projeto e pela área de Apps do Overview.
 */

import { ChevronRight, Plus, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { type AppDef } from "@/lib/apps/registry";
import { cn } from "@/lib/utils";

type AppDesktopProps = {
  /** Catálogo já filtrado pelo que o usuário pode ver. */
  apps: AppDef[];
  /** App aberto (controlado de fora — sincroniza com ?app= na URL). */
  openAppKey: string | null;
  onOpenAppKeyChange: (key: string | null) => void;
  /** Render da superfície do app aberto. */
  renderSurface: (app: AppDef) => React.ReactNode;
  /** Texto à direita da key no chrome da janela (ex.: nome do projeto). */
  windowSubtitle?: string;
  /** Linha de status acima do canvas (ex.: telemetria do pool de contexto). */
  statusSlot?: React.ReactNode;
  /** Quando presente, mostra o botão "Novo" no dock. */
  onCreateApp?: () => void;
  /** Rótulo do catálogo (default "Catálogo"). */
  catalogLabel?: string;
};

export function AppDesktop({
  apps,
  openAppKey,
  onOpenAppKeyChange,
  renderSurface,
  windowSubtitle,
  statusSlot,
  onCreateApp,
  catalogLabel = "Catálogo",
}: AppDesktopProps) {
  const installedApps = apps.filter((a) => a.status === "installed");
  // Resolve contra a lista visível — URL forçada (?app= sem permissão, ou app
  // ainda `available`) não abre superfície.
  const openApp = openAppKey
    ? installedApps.find((a) => a.key === openAppKey)
    : undefined;

  return (
    <div className="flex flex-col gap-3 md:flex-row">
      {/* ─── Dock (activity bar) — barra horizontal no mobile, coluna no desktop ── */}
      <aside className="flex w-full shrink-0 flex-row items-center gap-1 self-start rounded-md border p-1.5 md:w-16 md:flex-col">
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
                "relative flex flex-1 flex-col items-center gap-1 rounded-md px-1 py-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-full md:flex-none",
                active &&
                  "bg-[var(--accent-red-tint-hover)] text-foreground ring-1 ring-inset ring-[var(--accent-red-ring)]",
              )}
            >
              <app.icon
                className={cn(
                  "size-[22px] transition-transform",
                  active && "scale-[1.08] text-primary",
                )}
              />
              <span className="line-clamp-2 text-center text-[10px] leading-tight">
                {app.name}
              </span>
            </button>
          );
        })}
        {onCreateApp && (
          <>
            <div className="mx-0.5 h-8 w-px shrink-0 self-center bg-border md:mx-0 md:my-0.5 md:h-px md:w-8" />
            <button
              type="button"
              onClick={onCreateApp}
              title="Criar app com Volund OS"
              aria-label="Criar app"
              className="flex flex-1 flex-col items-center gap-1 rounded-md border border-dashed px-1 py-1.5 text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-full md:flex-none"
            >
              <Plus className="size-[22px]" />
              <span className="text-center text-[10px] leading-tight">Novo</span>
            </button>
          </>
        )}
      </aside>

      {/* ─── Canvas ───────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 space-y-3">
        {statusSlot}

        {openApp ? (
          /* Janela do app — live canvas, sem sair do tab. O X volta pro catálogo. */
          <div className="overflow-hidden rounded-md border">
            <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
              <span
                aria-hidden
                className={cn("size-1.5 shrink-0 rounded-full", openApp.dot)}
              />
              <openApp.icon className="size-4 shrink-0 text-muted-foreground" />
              <p className="min-w-0 flex-1 truncate text-sm">
                <span className="font-mono font-medium">{openApp.key}</span>
                {windowSubtitle && (
                  <span className="ml-1.5 text-muted-foreground">
                    · {windowSubtitle}
                  </span>
                )}
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
            <div className="p-4">{renderSurface(openApp)}</div>
          </div>
        ) : (
          /* Catálogo — registry rows, gramática de arquivos */
          <div>
            <p className="px-1 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {catalogLabel} · {apps.length}
            </p>
            {apps.length === 0 ? (
              <div className="rounded-md border px-3 py-8 text-center text-sm text-muted-foreground">
                Nenhum app disponível para o seu nível de acesso.
              </div>
            ) : (
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
                        if (
                          isInstalled &&
                          (e.key === "Enter" || e.key === " ")
                        ) {
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
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          app.dot,
                        )}
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
            )}
          </div>
        )}
      </div>
    </div>
  );
}
