/**
 * App Acessos (Overview, admin-only) — acesso efetivo + concessões por membro.
 */
import { KeyRound } from "lucide-react";

import { AccessApp } from "@/components/apps/access/access-app";
import { defineApp } from "@/lib/apps/define-app";

export const accessApp = defineApp({
  scope: "overview",
  key: "access",
  name: "Acessos",
  tagline: "Acesso efetivo e concessões por membro",
  description:
    "Visão do acesso efetivo de cada membro (nível global + projetos + concessões) e override por capability — libera/revoga apps e rituais por projeto. Admin-only.",
  icon: KeyRound,
  dot: "bg-rose-500",
  window: "3xl",
  minAccessLevel: "admin",
  Surface: () => <AccessApp />,
});
