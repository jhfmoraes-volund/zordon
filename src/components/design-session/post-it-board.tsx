"use client";

import { useEffect, useRef } from "react";
import { StickyNote } from "lucide-react";
import { BoardColumn, BoardLayout, StickyCard, type Accent } from "./board";

export type PostItItem = { id: string; text: string };

export type PostItTone = "emerald" | "rose" | "sky" | "amber" | "neutral";

export type PostItSection = {
  key: string;
  title: string;
  tone: PostItTone;
  items: PostItItem[];
};

// Map the public PostItTone API onto the board's Accent type. They share names
// so this is a no-op, but the explicit map keeps the boundary documented.
const TONE_TO_ACCENT: Record<PostItTone, Accent> = {
  emerald: "emerald",
  rose: "rose",
  sky: "sky",
  amber: "amber",
  neutral: "neutral",
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
  const cols = columns === 2 ? "double" : columns === 3 ? "triple" : "quad";

  return (
    <BoardLayout cols={cols}>
      {sections.map((section) => (
        <PostItColumn
          key={section.key}
          section={section}
          onAdd={(text) => onAdd(section.key, text)}
          onUpdate={(itemId, text) => onUpdate(section.key, itemId, text)}
          onDelete={(itemId) => onDelete(section.key, itemId)}
        />
      ))}
    </BoardLayout>
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
  const accent = TONE_TO_ACCENT[section.tone];

  return (
    <BoardColumn
      accent={accent}
      icon={<StickyNote className="size-4" />}
      title={section.title}
      count={section.items.length}
      countLabel="item"
      emptyIcon={StickyNote}
      emptyTitle="Nenhum item ainda"
      emptyHint="Curto e afirmativo. Enter pra confirmar."
      onAdd={onAdd}
      addPlaceholder="Adicionar..."
    >
      {/* CSS multi-column layout. Items flow top→bottom inside each column
       *  before wrapping to the next, with natural height per item. Tall
       *  items push only the items below them in the same column — no row
       *  alignment between columns (which is the whole point: a long post-it
       *  shouldn't leave empty space next to a short one). */}
      <div className="columns-1 sm:columns-2 gap-3 [column-fill:balance]">
        {section.items.map((item) => (
          <PostItPaperCard
            key={item.id}
            accent={accent}
            item={item}
            onUpdate={(text) => onUpdate(item.id, text)}
            onDelete={() => onDelete(item.id)}
          />
        ))}
      </div>
    </BoardColumn>
  );
}

// ─── PostItPaperCard ───────────────────────────────────────
// StickyCard `variant="paper"` with an always-editable textarea body. Now
// grows to fit its content — no fixed height. `break-inside-avoid` keeps a
// single post-it from being split across columns.

function PostItPaperCard({
  accent,
  item,
  onUpdate,
  onDelete,
}: {
  accent: Accent;
  item: PostItItem;
  onUpdate: (text: string) => void;
  onDelete: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea to fit its content. Without this, the <textarea>
  // would scroll instead of pushing the card taller.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [item.text]);

  return (
    <StickyCard
      accent={accent}
      variant="paper"
      onDelete={onDelete}
      className="mb-3 break-inside-avoid"
      collapsed={
        <textarea
          ref={textareaRef}
          rows={1}
          className="w-full resize-none overflow-hidden bg-transparent text-sm leading-snug outline-none placeholder:opacity-50"
          value={item.text}
          onChange={(e) => onUpdate(e.target.value)}
          placeholder="Escreva..."
        />
      }
    />
  );
}
