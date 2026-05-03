"use client";

import { useEffect, useState } from "react";
import { CheckSquare2, ListChecks, Plus, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AC } from "./types";
import { acProgress } from "./helpers";

/** Strip leading markdown checkbox markers ("- [ ]", "- [x]", "* [ ]", "[ ]") that
 *  legacy AC rows carry as literal text — the checkbox already conveys that state. */
function stripAcMarker(text: string): string {
  return text.replace(/^\s*(?:[-*]\s*)?\[[ xX]\]\s*/, "");
}

type ViewProps = {
  mode: "view";
  items: AC[];
};

/** Synchronous edit: handlers mutate parent draft state only. Used for
 *  forms that commit on a "Salvar" button (story-sheet). */
type EditDraftProps = {
  mode: "editDraft";
  items: AC[];
  onToggle: (id: string) => void;
  onChange: (id: string, text: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
};

/** Async edit: every operation persists individually with optimistic apply
 *  + rollback in the parent. Used in the open-task TaskSheet. */
type EditPersistedProps = {
  mode: "editPersisted";
  items: AC[];
  onToggle: (id: string, checked: boolean) => void | Promise<void>;
  onTextCommit: (id: string, text: string) => void | Promise<void>;
  onAdd: () => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
};

type Props = (ViewProps | EditDraftProps | EditPersistedProps) & {
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
        <ul className="divide-y divide-border/40 rounded-md border border-border/40 bg-muted/20">
          {items.map((ac) => (
            <li key={ac.id} className="flex items-start gap-2.5 px-2.5 py-2 text-sm">
              {ac.checked ? (
                <CheckSquare2 className="mt-0.5 size-4 shrink-0 text-green-600" />
              ) : (
                <Square className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
              )}
              <span
                className={`flex-1 leading-snug ${
                  ac.checked ? "text-muted-foreground line-through" : ""
                }`}
              >
                {stripAcMarker(ac.text)}
              </span>
              {ac.checkedBy ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  ✓ {ac.checkedBy}
                </span>
              ) : null}
            </li>
          ))}
          {items.length === 0 ? (
            <li className="px-2.5 py-2 text-xs text-muted-foreground">
              Nenhum critério ainda.
            </li>
          ) : null}
        </ul>
      ) : (
        <div className="space-y-2">
          <div className="divide-y divide-border/40 rounded-md border border-border/40 bg-muted/10">
            {items.map((ac) =>
              props.mode === "editDraft" ? (
                <AcEditRow
                  key={ac.id}
                  ac={ac}
                  onToggle={() => props.onToggle(ac.id)}
                  onTextCommit={(text) => props.onChange(ac.id, text)}
                  onRemove={() => props.onRemove(ac.id)}
                />
              ) : (
                <AcEditRow
                  key={ac.id}
                  ac={ac}
                  onToggle={() => props.onToggle(ac.id, !ac.checked)}
                  onTextCommit={(text) => props.onTextCommit(ac.id, text)}
                  onRemove={() => props.onRemove(ac.id)}
                />
              ),
            )}
            {items.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-muted-foreground">
                Nenhum critério ainda.
              </div>
            ) : null}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void props.onAdd()}
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

type AcEditRowProps = {
  ac: AC;
  onToggle: () => void | Promise<void>;
  onTextCommit: (text: string) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
};

function AcEditRow({ ac, onToggle, onTextCommit, onRemove }: AcEditRowProps) {
  const display = stripAcMarker(ac.text);
  // Local draft keeps each keystroke off the parent re-render path; only
  // flushes upstream on blur. Reconcile when the prop changes externally.
  const [draft, setDraft] = useState(display);
  useEffect(() => {
    setDraft(display);
  }, [display]);

  return (
    <div className="flex items-start gap-2 px-2 py-1.5">
      <button
        type="button"
        onClick={() => void onToggle()}
        className="mt-1.5 shrink-0"
        aria-label={ac.checked ? "Desmarcar" : "Marcar"}
      >
        {ac.checked ? (
          <CheckSquare2 className="size-4 text-green-600" />
        ) : (
          <Square className="size-4 text-muted-foreground/60" />
        )}
      </button>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== ac.text) void onTextCommit(draft);
        }}
        placeholder="Critério verificável"
        rows={1}
        className={`field-sizing-content min-h-0 flex-1 resize-none border-0 bg-transparent px-1.5 py-1 text-sm leading-snug shadow-none focus-visible:ring-0 dark:bg-transparent ${
          ac.checked ? "text-muted-foreground line-through" : ""
        }`}
      />
      <Button
        size="icon-sm"
        variant="ghost"
        onClick={() => void onRemove()}
        aria-label="Remover"
        className="mt-0.5 shrink-0 text-muted-foreground/60 hover:text-foreground"
      >
        <Trash2 />
      </Button>
    </div>
  );
}
