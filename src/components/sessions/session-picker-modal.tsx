"use client";

import { MessageSquare, Sparkles } from "lucide-react";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";

type SessionType = "inception" | "prd-quickask";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (type: SessionType) => void;
};

const SESSION_OPTIONS = [
  {
    type: "inception" as const,
    icon: Sparkles,
    title: "Inception",
    description: "Sessão de imersão completa para investigar e validar novos produtos",
  },
  {
    type: "prd-quickask" as const,
    icon: MessageSquare,
    title: "PRD Session (Quick-ask)",
    description: "Descreva sua ideia em poucas frases e Vitor gera PRDs estruturados",
  },
];

export function SessionPickerModal({ open, onOpenChange, onSelect }: Props) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Nova Session</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Escolha o tipo de session que deseja criar
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="grid gap-3 py-4">
          {SESSION_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.type}
                type="button"
                onClick={() => {
                  onSelect(option.type);
                  onOpenChange(false);
                }}
                className={cn(
                  "flex items-start gap-4 rounded-lg border p-4 text-left transition-colors",
                  "hover:bg-accent/50 hover:border-primary/50",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                )}
              >
                <div className="rounded-md bg-primary/10 p-2.5 shrink-0">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm mb-1">{option.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {option.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
