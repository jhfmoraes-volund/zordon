/**
 * Zordon Apps — registry da área de Apps do Overview (org-level).
 *
 * Mesmo conceito dos apps que moram nos projetos (src/lib/apps/registry.ts),
 * mas os apps são diferentes: operam na escala da operação inteira, não de um
 * projeto. Por isso não emitem context pool (`produces` vazio) — o contrato
 * "app = unidade de input de contexto" é do escopo de projeto.
 *
 * O registry é só metadata — o dispatch de superfície vive em
 * src/components/overview/overview-apps-desktop.tsx. A visibilidade por nível
 * de acesso é resolvida no server (apps-view.tsx) e refiltrada aqui no client.
 */
import { Wallet } from "lucide-react";

import { type AppDef } from "./registry";

export const OVERVIEW_APP_REGISTRY: AppDef[] = [
  {
    key: "finance",
    name: "S&OP",
    tagline: "Receita, despesa e margem por projeto",
    description:
      "Análise financeira da operação — receita e despesa por projeto e por mês, com margem de ganho. Dado sensível: visível só para admin.",
    icon: Wallet,
    dot: "bg-emerald-500",
    window: "3xl",
    produces: {},
    minAccessLevel: "admin",
    status: "installed",
  },
];

export function getOverviewApp(key: string): AppDef | undefined {
  return OVERVIEW_APP_REGISTRY.find((a) => a.key === key);
}
