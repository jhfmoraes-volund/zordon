/**
 * Zordon Apps — registry da área de Apps do cliente (client-level).
 *
 * Mesmo conceito dos apps de projeto (src/lib/apps/registry.ts) e do Overview
 * (overview-registry.ts), mas escopados a um cliente: gestão de inovação
 * (Oportunidades) e satisfação (CSAT). Não emitem context pool (`produces`
 * vazio) — o contrato "app = unidade de input de contexto" é do escopo de
 * projeto.
 *
 * O registry é só metadata — o dispatch de superfície vive em
 * src/components/clients/client-apps-desktop.tsx.
 *
 * D5 — Gating: as páginas atuais (opportunities/page.tsx, csat/page.tsx) NÃO
 * têm gate de access_level (a barreira real é RLS + o proxy, que já bloqueia
 * guest fora do escopo de projeto). Por isso `minAccessLevel` fica undefined
 * nos dois — não apertamos nem afrouxamos o comportamento atual.
 */
import { Lightbulb, MessageSquareHeart } from "lucide-react";

import { type AppDef } from "./registry";

export const CLIENT_APP_REGISTRY: AppDef[] = [
  {
    key: "opportunities",
    name: "Inovação",
    tagline: "Oportunidades do cliente, priorizadas",
    description:
      "Backlog de inovação do cliente — oportunidades com impacto × esforço, priorização e promoção a projeto (Design Session de Inception).",
    icon: Lightbulb,
    dot: "bg-amber-500",
    window: "3xl",
    produces: {},
    status: "installed",
  },
  {
    key: "csat",
    name: "Satisfação",
    tagline: "Entrevistas de CSAT e NPS",
    description:
      "Pesquisas de satisfação do cliente — CSAT, NPS, metodologia e time, com o que está bom e o que melhorar por entrevista.",
    icon: MessageSquareHeart,
    dot: "bg-rose-500",
    window: "2xl",
    produces: {},
    status: "installed",
  },
];

export function getClientApp(key: string): AppDef | undefined {
  return CLIENT_APP_REGISTRY.find((a) => a.key === key);
}
