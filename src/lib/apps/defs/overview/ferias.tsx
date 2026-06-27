/**
 * App Férias & Folgas (Overview, manager-only) — Calendário, saldos e banco de horas do time
 */
import { CalendarDays } from "lucide-react";

import { FeriasApp } from "@/components/apps/ferias/ferias-app";
import { defineApp } from "@/lib/apps/define-app";

export const feriasApp = defineApp({
  scope: "overview",
  key: "ferias",
  name: "Férias & Folgas",
  tagline: "Calendário, saldos e banco de horas do time",
  description:
    "Gestão de férias e folgas do time interno — calendário por membro, saldo de férias (PJ 10 dias úteis · CLT 30 corridos) e banco de horas de folga (1.5×). PM e Admin; o PM edita só o próprio squad.",
  icon: CalendarDays,
  dot: "bg-teal-500",
  window: "3xl",
  minAccessLevel: "manager",
  Surface: (ctx) => <FeriasApp accessLevel={ctx.accessLevel} />,
});
