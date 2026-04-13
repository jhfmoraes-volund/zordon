"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Info, AlertTriangle, Lightbulb, ChevronDown, ChevronRight, ArrowRight,
} from "lucide-react";
import type { ContentBlock } from "@/lib/workflow-content";

export function ContentBlockRenderer({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case "text":
      return <p className="text-sm text-muted-foreground leading-relaxed">{block.body}</p>;

    case "callout":
      return <CalloutBlock variant={block.variant} body={block.body} />;

    case "table":
      return <TableBlock headers={block.headers} rows={block.rows} />;

    case "steps":
      return <StepsBlock items={block.items} />;

    case "flow":
      return <FlowBlock steps={block.steps} />;

    case "cards":
      return <CardsBlock items={block.items} />;

    case "code":
      return <CodeBlock body={block.body} />;

    default:
      return null;
  }
}

// ─── Callout ──────────────────────────────────────────────

function CalloutBlock({ variant, body }: { variant: "info" | "warning" | "tip"; body: string }) {
  const config = {
    info: { icon: Info, color: "text-blue-400", bg: "!bg-blue-500/10" },
    warning: { icon: AlertTriangle, color: "text-yellow-400", bg: "!bg-yellow-500/10" },
    tip: { icon: Lightbulb, color: "text-green-400", bg: "!bg-green-500/10" },
  };
  const c = config[variant];

  return (
    <div className={`surface-inset ${c.bg} p-3`}>
      <div className="flex gap-2.5">
        <c.icon className={`h-4 w-4 mt-0.5 shrink-0 ${c.color}`} />
        <p className="text-sm leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────

function TableBlock({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="surface-inset overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-foreground/5">
            {headers.map((h, i) => (
              <th key={i} className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wide px-3 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-foreground/5 last:border-0">
              {row.map((cell, j) => (
                <td key={j} className={`px-3 py-2 ${j === 0 ? "font-medium" : "text-muted-foreground"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Steps ────────────────────────────────────────────────

function StepsBlock({ items }: { items: { title: string; description: string }[] }) {
  return (
    <div className="space-y-0">
      {items.map((step, i) => (
        <div key={i} className="flex gap-3">
          {/* Line + dot */}
          <div className="flex flex-col items-center">
            <div className="h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0">
              {i + 1}
            </div>
            {i < items.length - 1 && <div className="w-px flex-1 bg-foreground/10 my-1" />}
          </div>
          {/* Content */}
          <div className="pb-4">
            <p className="text-sm font-medium">{step.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Flow ─────────────────────────────────────────────────

function FlowBlock({ steps }: { steps: { label: string; sub?: string }[] }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-1 shrink-0">
          <div className="surface-inset px-3 py-2 text-center min-w-[90px]">
            <p className="text-xs font-medium">{step.label}</p>
            {step.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{step.sub}</p>}
          </div>
          {i < steps.length - 1 && (
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Cards ────────────────────────────────────────────────

function CardsBlock({ items }: { items: { title: string; summary: string; details?: string[]; badge?: string }[] }) {
  return (
    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
      {items.map((item, i) => (
        <ConceptCard key={i} {...item} />
      ))}
    </div>
  );
}

function ConceptCard({ title, summary, details, badge }: { title: string; summary: string; details?: string[]; badge?: string }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = details && details.length > 0;

  return (
    <div
      className={`surface-inset p-3 ${hasDetails ? "cursor-pointer" : ""}`}
      onClick={() => hasDetails && setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{title}</p>
          {badge && <Badge variant="outline" className="text-[10px]">{badge}</Badge>}
        </div>
        {hasDetails && (
          expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{summary}</p>
      {expanded && details && (
        <ul className="mt-2 space-y-1 border-t border-foreground/5 pt-2">
          {details.map((d, i) => (
            <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
              <span className="text-muted-foreground/40 mt-0.5">•</span>
              <span>{d}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Code ─────────────────────────────────────────────────

function CodeBlock({ body }: { body: string }) {
  return (
    <pre className="surface-nested p-4 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre">
      {body}
    </pre>
  );
}
