"use client";

import { CheckSquare2, ListChecks, Plus, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AC } from "./types";
import { acProgress } from "./helpers";

type ViewProps = {
  mode: "view";
  items: AC[];
};

type EditProps = {
  mode: "edit";
  items: AC[];
  onToggle: (id: string) => void;
  onChange: (id: string, text: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
};

type Props = (ViewProps | EditProps) & {
  /** Header label override. Default: "Acceptance Criteria" */
  label?: string;
  /** Show the ListChecks icon next to header. Default true. */
  showIcon?: boolean;
};

export function AcList(props: Props) {
  const { items, label = "Acceptance Criteria", showIcon = true } = props;
  const { total, done } = acProgress(items);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {showIcon ? <ListChecks className="size-3.5" /> : null}
          {label}
        </h4>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {done} / {total}
        </span>
      </div>

      {props.mode === "view" ? (
        <ul className="space-y-1.5">
          {items.map((ac) => (
            <li key={ac.id} className="flex items-start gap-2 text-sm">
              {ac.checked ? (
                <CheckSquare2 className="mt-0.5 size-4 shrink-0 text-green-600" />
              ) : (
                <Square className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
              )}
              <span className="flex-1">{ac.text}</span>
              {ac.checkedBy ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  ✓ {ac.checkedBy}
                </span>
              ) : null}
            </li>
          ))}
          {items.length === 0 ? (
            <li className="text-xs text-muted-foreground">
              Nenhum critério ainda.
            </li>
          ) : null}
        </ul>
      ) : (
        <div className="space-y-2">
          {items.map((ac) => (
            <div key={ac.id} className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => props.onToggle(ac.id)}
                className="mt-1.5 shrink-0"
                aria-label={ac.checked ? "Desmarcar" : "Marcar"}
              >
                {ac.checked ? (
                  <CheckSquare2 className="size-4 text-green-600" />
                ) : (
                  <Square className="size-4 text-muted-foreground/60" />
                )}
              </button>
              <Input
                value={ac.text}
                onChange={(e) => props.onChange(ac.id, e.target.value)}
                placeholder="Critério verificável"
                className="flex-1"
              />
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => props.onRemove(ac.id)}
                aria-label="Remover"
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={props.onAdd}
            className="w-full"
          >
            <Plus className="size-3.5" />
            Adicionar critério
          </Button>
        </div>
      )}
    </section>
  );
}
