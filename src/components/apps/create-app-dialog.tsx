"use client";

/**
 * "Criar app" — mockado por enquanto: abre um dialog contando o que vem aí
 * (apps custom plugando agentes do Volund OS no projeto). Vira fluxo real
 * quando a fase 2 (ProjectApp + agent-apps via API do Volund OS) chegar.
 */

import { Blocks, Bot, Database, Gauge, Globe } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

const CAPABILITIES = [
  {
    icon: Bot,
    title: "Agentes como apps",
    description:
      "Plugue um agente do Volund OS no projeto — com instruções e ferramentas próprias — e ele vira um app no dock.",
  },
  {
    icon: Database,
    title: "Context input de qualquer fonte",
    description:
      "Todo app alimenta o pool de contexto do projeto: integrações, datasets próprios, o que sua operação precisar.",
  },
  {
    icon: Gauge,
    title: "Dashboards sob medida",
    description:
      "Apps de métricas: monte visões de produtividade e delivery direto no canvas do projeto.",
  },
  {
    icon: Globe,
    title: "UI própria",
    description:
      "Apps avançados podem ter interface própria — até em outro domínio — falando com o agente e o pool de contexto.",
  },
];

export function CreateAppDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-rose-500/15 text-rose-500">
              <Blocks className="size-4" />
            </span>
            Criar app com Volund OS
            <Badge variant="outline" className="text-[10px] uppercase">
              em breve
            </Badge>
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Apps custom criados pela comunidade e pelo seu time, plugados no
            workspace do projeto.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <div className="grid gap-3 py-1">
            {CAPABILITIES.map((cap) => (
              <div key={cap.title} className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <cap.icon className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-medium leading-tight">{cap.title}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {cap.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Entendi
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
