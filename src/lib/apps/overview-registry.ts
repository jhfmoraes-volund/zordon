/**
 * Zordon Apps — registry da área de Apps do Overview (org-level).
 *
 * Barrel do App SDK: cada app é um módulo auto-contido em
 * src/lib/apps/defs/overview/<key>.tsx (metadata + Surface via defineApp).
 * Adicionar app = criar o def + 1 linha aqui — use a skill /new-app.
 *
 * Apps de Overview operam na escala da operação inteira (não de um projeto),
 * por isso não emitem context pool (`produces` vazio). O dispatch de superfície
 * e o filtro de acesso vivem no <AppHost> (src/components/apps/app-host.tsx);
 * a visibilidade é resolvida no server (apps-view.tsx) e refiltrada lá.
 *
 * Os marcadores <new-app:*> abaixo são âncoras pro gerador scripts/new-app.ts —
 * não remova.
 */
import { type AppModule } from "@/lib/apps/define-app";
import { accessApp } from "@/lib/apps/defs/overview/access";
import { financeApp } from "@/lib/apps/defs/overview/finance";
import { feriasApp } from "@/lib/apps/defs/overview/ferias";
// <new-app:import>

export const OVERVIEW_APP_REGISTRY: AppModule<"overview">[] = [
  financeApp,
  accessApp,
  feriasApp,
  // <new-app:entry>
];

export function getOverviewApp(
  key: string,
): AppModule<"overview"> | undefined {
  return OVERVIEW_APP_REGISTRY.find((a) => a.key === key);
}
