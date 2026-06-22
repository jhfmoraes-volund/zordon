import { getEffectiveAccessLevel } from "@/lib/dal";
import { OverviewAppsDesktop } from "./overview-apps-desktop";

/**
 * Aba "Apps" do Overview. Server component — resolve o nível de acesso do
 * usuário (a visibilidade dos apps é por nível; finanças é admin-only) e
 * delega o render pro desktop client. A barreira real do dado fica na RLS +
 * nas rotas /api/finance/* (ver docs/features/finance/finance-app-plan.md).
 */
export async function AppsView() {
  const accessLevel = await getEffectiveAccessLevel();
  return <OverviewAppsDesktop accessLevel={accessLevel} />;
}
