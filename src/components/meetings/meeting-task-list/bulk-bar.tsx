"use client";

import { Button } from "@/components/ui/button";
import { CheckCircle2, X, XCircle } from "lucide-react";

type Props = {
  count: number;
  onApprove?: () => Promise<void>;
  onReject?: () => Promise<void>;
  onClear: () => void;
};

export function MeetingBulkBar({ count, onApprove, onReject, onClear }: Props) {
  return (
    <div className="surface fixed inset-x-3 bottom-3 z-30 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-3 rounded-full px-4 py-2 shadow-lg sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2">
      <span className="text-sm">
        <strong>{count}</strong>{" "}
        {count === 1 ? "proposta selecionada" : "propostas selecionadas"}
      </span>
      <div className="flex items-center gap-2">
        {onApprove && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-green-700 hover:text-green-800"
            onClick={onApprove}
          >
            <CheckCircle2 className="mr-1 size-3.5" />
            Aprovar
          </Button>
        )}
        {onReject && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-red-700 hover:text-red-800"
            onClick={onReject}
          >
            <XCircle className="mr-1 size-3.5" />
            Rejeitar
          </Button>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={onClear}
        aria-label="Limpar seleção"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
