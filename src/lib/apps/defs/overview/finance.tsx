/**
 * App S&OP (Overview, admin-only) — análise financeira da operação.
 * Reporta o projeto aberto como subtítulo da janela; lê ?fp= pra deep-link.
 */
import { Wallet } from "lucide-react";

import { FinanceApp } from "@/components/apps/finance/finance-app";
import { defineApp } from "@/lib/apps/define-app";

export const financeApp = defineApp({
  scope: "overview",
  key: "finance",
  name: "S&OP",
  tagline: "Receita, despesa e margem por projeto",
  description:
    "Análise financeira da operação — receita e despesa por projeto e por mês, com margem de ganho. Dado sensível: visível só para admin.",
  icon: Wallet,
  dot: "bg-emerald-500",
  window: "3xl",
  minAccessLevel: "admin",
  Surface: (ctx) => (
    <FinanceApp
      initialProjectId={ctx.searchParams.get("fp")}
      onSelectedProjectChange={(name) => ctx.setWindowSubtitle(name)}
    />
  ),
});
