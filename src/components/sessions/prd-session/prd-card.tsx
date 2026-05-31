"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import type { ChipTone } from "@/lib/status-chips";
import type { ProductRequirementRow } from "@/lib/dal/product-requirements";

type AcceptanceCriterion = {
  given?: string;
  when?: string;
  then?: string;
  text?: string;
};

const STATUS_TONE: Record<string, ChipTone> = {
  draft: "slate",
  review: "amber",
  approved: "green",
  ready: "green",
  superseded: "muted",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  review: "Em revisão",
  approved: "Aprovado",
  ready: "Ready",
  superseded: "Substituído",
};

type Props = {
  prd: ProductRequirementRow;
  projectId: string;
};

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function formatAc(ac: AcceptanceCriterion, idx: number): string {
  if (ac.text) return ac.text;
  const parts: string[] = [];
  if (ac.given) parts.push(`Dado ${ac.given}`);
  if (ac.when) parts.push(`quando ${ac.when}`);
  if (ac.then) parts.push(`então ${ac.then}`);
  return parts.length > 0 ? parts.join(", ") : `Critério ${idx + 1}`;
}

export function PrdCard({ prd, projectId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const acs = asArray<AcceptanceCriterion>(prd.acceptanceCriteria);
  const status = prd.status as keyof typeof STATUS_TONE;
  const tone = STATUS_TONE[status] ?? "slate";
  const label = STATUS_LABEL[status] ?? status;

  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums shrink-0">
          {prd.reference}
        </span>
        <span className="flex-1 min-w-0 truncate text-sm font-medium">
          {prd.title}
        </span>
        <StatusChip tone={tone} className="shrink-0 text-[10px]">
          {label}
        </StatusChip>
        <Link
          href={`/projects/${projectId}/prds/${prd.id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label="Abrir PRD em nova aba"
          className="shrink-0 inline-flex size-6 items-center justify-center rounded-sm hover:bg-accent text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3" />
        </Link>
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-150",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t bg-muted/20 px-3 py-3 space-y-3 text-xs">
            {prd.oneLiner && (
              <p className="text-foreground/90 italic">{prd.oneLiner}</p>
            )}
            {prd.problem && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Problema
                </p>
                <p className="text-foreground/90 whitespace-pre-wrap">
                  {prd.problem}
                </p>
              </div>
            )}
            {prd.goal && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Objetivo
                </p>
                <p className="text-foreground/90 whitespace-pre-wrap">
                  {prd.goal}
                </p>
              </div>
            )}
            {acs.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Critérios de aceite ({acs.length})
                </p>
                <ul className="space-y-1 list-disc list-inside marker:text-muted-foreground">
                  {acs.map((ac, i) => (
                    <li key={i} className="text-foreground/90">
                      {formatAc(ac, i)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
