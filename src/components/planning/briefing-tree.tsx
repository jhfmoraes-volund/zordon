"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChipTone } from "@/lib/status-chips";

type NoteKind =
  | "summary"
  | "theme"
  | "risk"
  | "capacity_signal"
  | "code_observation"
  | "open_question";

interface BriefingNote {
  id: string;
  kind: string;
  content: string;
  priority: number;
  dismissedAt: string | null;
}

interface BriefingTreeProps {
  notes: BriefingNote[];
  onDismiss: (noteId: string) => void;
}

const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  summary: "Resumo",
  theme: "Tema",
  risk: "Risco",
  capacity_signal: "Capacidade",
  code_observation: "Código",
  open_question: "Questão",
};

const NOTE_KIND_TONE: Record<NoteKind, ChipTone> = {
  summary: "blue",
  theme: "purple",
  risk: "red",
  capacity_signal: "amber",
  code_observation: "muted",
  open_question: "cyan",
};

const KIND_ORDER: NoteKind[] = [
  "summary",
  "theme",
  "risk",
  "capacity_signal",
  "code_observation",
  "open_question",
];

export function BriefingTree({ notes, onDismiss }: BriefingTreeProps) {
  const grouped = KIND_ORDER.reduce<Partial<Record<NoteKind, BriefingNote[]>>>(
    (acc, kind) => {
      acc[kind] = notes.filter((n) => n.kind === kind).sort((a, b) => a.priority - b.priority);
      return acc;
    },
    {},
  );

  const kindsWithNotes = KIND_ORDER.filter((k) => (grouped[k]?.length ?? 0) > 0);

  const [open, setOpen] = useState<Set<NoteKind>>(
    () => new Set(kindsWithNotes.filter((k) => k === "summary")),
  );

  const toggle = (kind: NoteKind) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  if (kindsWithNotes.length === 0) return null;

  return (
    <section className="surface divide-y overflow-hidden rounded-lg border">
      {kindsWithNotes.map((kind) => {
        const items = grouped[kind] ?? [];
        const isOpen = open.has(kind);
        const tone = NOTE_KIND_TONE[kind];
        const label = NOTE_KIND_LABEL[kind];

        return (
          <div key={kind}>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40"
              onClick={() => toggle(kind)}
              aria-expanded={isOpen}
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              <StatusChip tone={tone} label={label} />
              <span className="ml-auto text-xs text-muted-foreground">{items.length}</span>
            </button>

            <div
              className={cn(
                "overflow-hidden transition-all",
                isOpen ? "max-h-[2000px]" : "max-h-0",
              )}
            >
              <ul className="space-y-2 px-4 pb-3 pt-1">
                {items.map((note) => (
                  <li key={note.id} className="rounded-lg border p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm leading-relaxed">{note.content}</p>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                        title="Dispensar"
                        onClick={() => onDismiss(note.id)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </section>
  );
}
