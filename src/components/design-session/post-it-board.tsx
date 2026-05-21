"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

export type PostItItem = { id: string; text: string };

export type PostItTone = "emerald" | "rose" | "sky" | "amber" | "neutral";

export type PostItSection = {
  key: string;
  title: string;
  tone: PostItTone;
  items: PostItItem[];
};

// Cada tom resolve para 3 CSS vars (bg/border/text) definidas em globals.css.
// Light: papel pastel; Dark: fundo desaturado + tinta clara tonal.
const TONE_STYLE: Record<PostItTone, { bg: string; border: string; text: string }> = {
  emerald: {
    bg: "var(--paper-emerald-bg)",
    border: "var(--paper-emerald-border)",
    text: "var(--paper-emerald-text)",
  },
  rose: {
    bg: "var(--paper-rose-bg)",
    border: "var(--paper-rose-border)",
    text: "var(--paper-rose-text)",
  },
  sky: {
    bg: "var(--paper-sky-bg)",
    border: "var(--paper-sky-border)",
    text: "var(--paper-sky-text)",
  },
  amber: {
    bg: "var(--paper-amber-bg)",
    border: "var(--paper-amber-border)",
    text: "var(--paper-amber-text)",
  },
  neutral: {
    bg: "var(--muted)",
    border: "var(--border)",
    text: "var(--muted-foreground)",
  },
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
  const gridClass =
    columns === 2 ? "md:grid-cols-2" :
    columns === 3 ? "md:grid-cols-3" :
    "md:grid-cols-4";

  return (
    <div className={`grid gap-6 ${gridClass}`}>
      {sections.map((section) => (
        <PostItColumn
          key={section.key}
          section={section}
          onAdd={(text) => onAdd(section.key, text)}
          onUpdate={(itemId, text) => onUpdate(section.key, itemId, text)}
          onDelete={(itemId) => onDelete(section.key, itemId)}
        />
      ))}
    </div>
  );
}

function PostItColumn({
  section,
  onAdd,
  onUpdate,
  onDelete,
}: {
  section: PostItSection;
  onAdd: (text: string) => void;
  onUpdate: (itemId: string, text: string) => void;
  onDelete: (itemId: string) => void;
}) {
  const tone = TONE_STYLE[section.tone];

  return (
    <section className="space-y-3">
      <header className="flex items-center gap-2">
        <span
          className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide"
          style={{
            backgroundColor: tone.bg,
            borderColor: tone.border,
            color: tone.text,
          }}
        >
          {section.title}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {section.items.length}
        </span>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {section.items.map((item) => (
          <PostItCard
            key={item.id}
            item={item}
            tone={tone}
            onUpdate={(text) => onUpdate(item.id, text)}
            onDelete={() => onDelete(item.id)}
          />
        ))}

        <AddPostIt tone={tone} onAdd={onAdd} />
      </div>
    </section>
  );
}

function PostItCard({
  item,
  tone,
  onUpdate,
  onDelete,
}: {
  item: PostItItem;
  tone: { bg: string; border: string; text: string };
  onUpdate: (text: string) => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="group relative flex h-[110px] flex-col rounded-md p-3 transition-transform duration-150 hover:-translate-y-0.5"
      style={{
        backgroundColor: tone.bg,
        borderLeft: `3px solid ${tone.border}`,
        color: tone.text,
        boxShadow: "var(--paper-shadow)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "var(--paper-shadow-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "var(--paper-shadow)";
      }}
    >
      <textarea
        className="h-full w-full resize-none bg-transparent pr-5 text-sm leading-snug outline-none placeholder:opacity-50"
        style={{ color: tone.text }}
        value={item.text}
        onChange={(e) => onUpdate(e.target.value)}
      />
      <button
        type="button"
        onClick={onDelete}
        aria-label="Remover"
        className="absolute top-1.5 right-1.5 rounded p-0.5 opacity-0 transition-opacity hover:bg-black/10 group-hover:opacity-100 dark:hover:bg-white/10"
        style={{ color: tone.text }}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function AddPostIt({
  tone,
  onAdd,
}: {
  tone: { bg: string; border: string; text: string };
  onAdd: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const commit = () => {
    const text = draft.trim();
    if (text) onAdd(text);
    setDraft("");
    setEditing(false);
  };

  const cancel = () => {
    setDraft("");
    setEditing(false);
  };

  if (editing) {
    return (
      <div
        className="flex h-[110px] flex-col rounded-md p-3"
        style={{
          backgroundColor: tone.bg,
          borderLeft: `3px solid ${tone.border}`,
          color: tone.text,
          boxShadow: "var(--paper-shadow)",
        }}
      >
        <textarea
          ref={textareaRef}
          className="h-full w-full resize-none bg-transparent text-sm leading-snug outline-none placeholder:opacity-50"
          style={{ color: tone.text }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          placeholder="Escreva e Enter pra confirmar..."
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex h-[110px] w-full items-center justify-center gap-1.5 rounded-md border border-dashed text-xs font-medium opacity-50 transition-opacity hover:opacity-100"
      style={{
        borderColor: tone.border,
        color: tone.text,
      }}
    >
      <Plus className="h-3.5 w-3.5" />
      adicionar
    </button>
  );
}
