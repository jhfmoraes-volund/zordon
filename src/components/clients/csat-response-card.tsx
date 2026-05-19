"use client";

import { useState } from "react";
import { ChevronDown, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { CsatResponse } from "@/lib/supabase/types";

export type CsatResponseWithInterviewer = CsatResponse & {
  interviewer: { id: string; name: string } | null;
};

type Props = {
  response: CsatResponseWithInterviewer;
  onEdit: () => void;
  onDelete: () => void;
};

function scoreTone(n: number): string {
  if (n >= 9) return "bg-green-500/15 text-green-700 border-green-500/25 dark:text-green-300";
  if (n >= 7) return "bg-amber-500/15 text-amber-700 border-amber-500/25 dark:text-amber-300";
  return "bg-red-500/15 text-red-700 border-red-500/25 dark:text-red-300";
}

function ScoreTile({ label, value }: { label: string; value: number }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 flex flex-col items-center justify-center min-w-0",
        scoreTone(value),
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80 truncate">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums leading-none mt-1">
        {value}
      </span>
    </div>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function CsatResponseCard({ response, onEdit, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasText = !!(response.whatsGood || response.whatsToImprove);

  return (
    <div className="surface p-4 space-y-3 relative">
      <div className="absolute top-2 right-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" />}
          >
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5 mr-2" />
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="pr-10 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
        <span className="font-medium text-foreground">
          {fmtDate(response.interviewedAt)}
        </span>
        {response.interviewer ? (
          <span>por {response.interviewer.name}</span>
        ) : null}
        {response.contactName ? (
          <span>· contato: {response.contactName}</span>
        ) : null}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <ScoreTile label="Metodologia" value={response.methodologyScore} />
        <ScoreTile label="Time" value={response.teamScore} />
        <ScoreTile label="CSAT" value={response.csatScore} />
        <ScoreTile label="NPS" value={response.npsScore} />
      </div>

      {hasText && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                expanded && "rotate-180",
              )}
            />
            {expanded ? "Ocultar comentários" : "Ver comentários"}
          </button>

          {expanded && (
            <div className="space-y-3 pt-1">
              {response.whatsGood && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    O que está bom
                  </div>
                  <p className="text-sm whitespace-pre-wrap">
                    {response.whatsGood}
                  </p>
                </div>
              )}
              {response.whatsToImprove && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    O que melhorar
                  </div>
                  <p className="text-sm whitespace-pre-wrap">
                    {response.whatsToImprove}
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
