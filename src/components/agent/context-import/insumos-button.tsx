"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface InsumosButtonProps {
  /** Total de fontes linkadas (transcript + planilha + github). 0 esconde o badge. */
  count?: number;
  onClick: () => void;
  /** Cada ribbon escolhe o peso visual; o label/ícone/contador é o que padronizamos. */
  variant?: "ghost" | "outline";
  size?: "sm" | "default";
  className?: string;
  disabled?: boolean;
}

/**
 * Botão "Insumos" canônico — label + ícone + contador padronizados.
 *
 * Único ponto de verdade pro affordance de "abrir o painel de insumos
 * (contexto importado)" que vive em cada ribbon de superfície (planning,
 * pm-review, prd-briefing, …). NÃO colapsa os ribbons: cada um mantém seu
 * conteúdo próprio e só embeda este botão, garantindo nome ("Insumos"),
 * ícone (FileText) e contador idênticos em toda a aplicação.
 */
export function InsumosButton({
  count = 0,
  onClick,
  variant = "outline",
  size = "sm",
  className,
  disabled,
}: InsumosButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      onClick={onClick}
      disabled={disabled}
      className={cn("gap-1.5", className)}
    >
      <FileText className="h-3.5 w-3.5" />
      Insumos
      {count > 0 && (
        <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 text-[10px]">
          {count}
        </Badge>
      )}
    </Button>
  );
}
