"use client";

import { StickyNote as StickyNoteIcon, Plus, Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export type Note = {
  id: string;
  text: string;
};

export function StickyNoteBoard({
  notes,
  onAdd,
  onUpdate,
  onDelete,
}: {
  notes: Note[];
  onAdd: () => void;
  onUpdate: (id: string, text: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="sticky top-0 w-72 space-y-3">
      <div className="flex items-center justify-between text-yellow-900/80 dark:text-yellow-200">
        <div className="flex items-center gap-2">
          <StickyNoteIcon className="h-4 w-4" />
          <span className="text-sm font-semibold">Anotações</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-yellow-900/60 hover:text-yellow-900 dark:text-yellow-200/60 dark:hover:text-yellow-200"
          onClick={onAdd}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {notes.map((note) => (
        <div
          key={note.id}
          className="rounded-sm bg-yellow-200 shadow-md p-3 space-y-2"
        >
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-yellow-900/40 hover:text-yellow-900"
              onClick={() => onDelete(note.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          <Textarea
            value={note.text}
            onChange={(e) => onUpdate(note.id, e.target.value)}
            placeholder="Anote aqui..."
            rows={4}
            className="resize-y border-none shadow-none bg-transparent! text-yellow-950 placeholder:text-yellow-800/40 text-sm focus-visible:ring-0"
          />
        </div>
      ))}

      {notes.length === 0 && (
        <button
          onClick={onAdd}
          className="w-full rounded-sm border-2 border-dashed border-yellow-300 dark:border-yellow-200/30 p-6 text-sm text-yellow-800/50 dark:text-yellow-200/40 hover:border-yellow-400 hover:text-yellow-800/70 transition-colors cursor-pointer"
        >
          Clique para adicionar uma anotação
        </button>
      )}
    </div>
  );
}
