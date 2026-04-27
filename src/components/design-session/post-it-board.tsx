"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";

export type PostItItem = { id: string; text: string };

export type PostItTone = "emerald" | "rose" | "sky" | "amber" | "neutral";

export type PostItSection = {
  key: string;
  title: string;
  tone: PostItTone;
  items: PostItItem[];
};

const TONE_BADGE: Record<PostItTone, string> = {
  emerald: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  rose: "bg-rose-500/15 text-rose-600 border-rose-500/30",
  sky: "bg-sky-500/15 text-sky-600 border-sky-500/30",
  amber: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

export function PostItBoard({
  sections,
  onAdd,
  onUpdate,
  onDelete,
  columns = 2,
}: {
  sections: PostItSection[];
  onAdd: (sectionKey: string, text: string) => void;
  onUpdate: (sectionKey: string, itemId: string, text: string) => void;
  onDelete: (sectionKey: string, itemId: string) => void;
  columns?: 2 | 3 | 4;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const handleAdd = (key: string) => {
    const text = drafts[key]?.trim();
    if (!text) return;
    onAdd(key, text);
    setDrafts((d) => ({ ...d, [key]: "" }));
  };

  const gridClass =
    columns === 2 ? "md:grid-cols-2" :
    columns === 3 ? "md:grid-cols-3" :
    "md:grid-cols-4";

  return (
    <div className={`grid gap-4 ${gridClass}`}>
      {sections.map((section) => (
        <div
          key={section.key}
          className="rounded-lg border bg-card p-4"
        >
          <div className="mb-3">
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold tracking-wide ${TONE_BADGE[section.tone]}`}
            >
              {section.title}
            </span>
          </div>

          <div className="space-y-2 mb-3">
            {section.items.map((item) => (
              <div
                key={item.id}
                className="group relative rounded-lg bg-card ring-1 ring-foreground/5 p-2.5"
              >
                <textarea
                  className="w-full bg-transparent text-sm text-foreground resize-none outline-none min-h-[40px]"
                  value={item.text}
                  onChange={(e) => onUpdate(section.key, item.id, e.target.value)}
                  rows={2}
                />
                <button
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/20"
                  onClick={() => onDelete(section.key, item.id)}
                >
                  <X className="h-3.5 w-3.5 text-red-500" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="Adicionar..."
              className="h-8 text-sm"
              value={drafts[section.key] || ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [section.key]: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && handleAdd(section.key)}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => handleAdd(section.key)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
