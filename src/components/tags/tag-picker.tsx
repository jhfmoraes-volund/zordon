"use client";

import * as React from "react";
import { Check, Plus, Tag as TagIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChipTone } from "@/lib/status-chips";
import { TAG_TONES, pickRandomTone } from "@/lib/task-tags";
import {
  TagChip,
  TagChipOverflow,
  type TagChipVariant,
} from "./tag-chip";

export type TagPickerOption = {
  id: string;
  name: string;
  tone: ChipTone;
};

export type TagPickerProps = {
  available: TagPickerOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onCreate: (
    name: string,
    tone: ChipTone,
  ) => TagPickerOption | Promise<TagPickerOption>;
  onRecolor?: (id: string, tone: ChipTone) => void;
  max?: number;
  variant?: TagChipVariant;
  triggerVisibleCount?: number;
  placeholder?: string;
};

const dotClassByTone: Record<ChipTone, string> = {
  blue: "bg-blue-500",
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  purple: "bg-purple-500",
  cyan: "bg-cyan-500",
  teal: "bg-teal-500",
  pink: "bg-pink-500",
  slate: "bg-slate-500",
  brand: "bg-primary",
  muted: "bg-muted-foreground/40",
};

export function TagPicker({
  available,
  selectedIds,
  onChange,
  onCreate,
  onRecolor,
  max = 10,
  variant = "solid",
  triggerVisibleCount = 2,
  placeholder = "Add tag",
}: TagPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [colorMenuFor, setColorMenuFor] = React.useState<string | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setColorMenuFor(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setColorMenuFor(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  React.useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
    }
  }, [open]);

  const selected = React.useMemo(
    () =>
      selectedIds
        .map((id) => available.find((t) => t.id === id))
        .filter((t): t is TagPickerOption => Boolean(t)),
    [selectedIds, available],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter((t) => t.name.toLowerCase().includes(q));
  }, [query, available]);

  const exactMatch = React.useMemo(
    () =>
      query.trim().length > 0 &&
      available.some(
        (t) => t.name.toLowerCase() === query.trim().toLowerCase(),
      ),
    [query, available],
  );

  const atLimit = selected.length >= max;
  const remaining = max - selected.length;

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((s) => s !== id));
    } else {
      if (atLimit) return;
      onChange([...selectedIds, id]);
    }
  }

  async function handleCreate() {
    const name = query.trim();
    if (!name || exactMatch || atLimit) return;
    const tone = pickRandomTone();
    const result = onCreate(name, tone);
    setQuery("");
    const created = result instanceof Promise ? await result : result;
    onChange([...selectedIds, created.id]);
  }

  const visible = selected.slice(0, triggerVisibleCount);
  const overflow = Math.max(0, selected.length - triggerVisibleCount);

  return (
    <div ref={wrapperRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/30",
          open && "ring-3 ring-ring/50 border-ring",
        )}
      >
        {selected.length === 0 ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <TagIcon className="size-3.5" />
            {placeholder}
          </span>
        ) : (
          <>
            {visible.map((t) => (
              <TagChip
                key={t.id}
                name={t.name}
                tone={t.tone}
                variant={variant}
                onRemove={() => toggle(t.id)}
              />
            ))}
            <TagChipOverflow count={overflow} variant={variant} />
          </>
        )}
        <span className="ml-auto pl-2 text-[10px] text-muted-foreground">
          {selected.length}/{max}
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 w-full min-w-[220px] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
          <div className="border-b border-border px-2 py-1.5">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered.length === 1) {
                    toggle(filtered[0].id);
                    return;
                  }
                  if (!exactMatch) handleCreate();
                }
              }}
              placeholder="Search or create"
              className="w-full bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="max-h-[260px] overflow-y-auto p-1">
            {filtered.length === 0 && !query.trim() ? (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                Sem tags ainda — digite pra criar
              </div>
            ) : null}

            {filtered.map((t) => {
              const checked = selectedIds.includes(t.id);
              const disabled = !checked && atLimit;
              return (
                <div key={t.id} className="group relative">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => toggle(t.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-sm outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40",
                    )}
                  >
                    <span
                      className={cn(
                        "size-2.5 shrink-0 rounded-full",
                        dotClassByTone[t.tone],
                      )}
                      aria-hidden
                    />
                    <span className="flex-1 truncate text-left">{t.name}</span>
                    {checked ? (
                      <Check className="size-3.5 text-foreground/70" />
                    ) : null}
                    {onRecolor ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setColorMenuFor((cur) =>
                            cur === t.id ? null : t.id,
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            setColorMenuFor((cur) =>
                              cur === t.id ? null : t.id,
                            );
                          }
                        }}
                        className="ml-1 hidden size-5 cursor-pointer items-center justify-center rounded hover:bg-foreground/10 group-hover:flex"
                        aria-label={`change color of ${t.name}`}
                      >
                        <span className="text-[10px] text-muted-foreground">
                          •••
                        </span>
                      </span>
                    ) : null}
                  </button>

                  {colorMenuFor === t.id && onRecolor ? (
                    <div className="absolute right-1 top-full z-10 mt-0.5 grid grid-cols-6 gap-1 rounded-md border border-border bg-popover p-1.5 shadow-md">
                      {TAG_TONES.map((tone) => (
                        <button
                          key={tone}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRecolor(t.id, tone);
                            setColorMenuFor(null);
                          }}
                          className={cn(
                            "size-5 rounded-full ring-1 ring-border transition-transform hover:scale-110",
                            dotClassByTone[tone],
                            t.tone === tone && "ring-2 ring-foreground",
                          )}
                          aria-label={tone}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {query.trim() && !exactMatch ? (
              <button
                type="button"
                disabled={atLimit}
                onClick={handleCreate}
                className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border/50 px-1.5 py-1.5 text-sm text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="size-3.5 text-muted-foreground" />
                <span>
                  Criar{" "}
                  <span className="font-medium">&ldquo;{query.trim()}&rdquo;</span>
                </span>
              </button>
            ) : null}
          </div>

          {atLimit ? (
            <div className="border-t border-border bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
              Limite de {max} tags atingido
            </div>
          ) : (
            <div className="border-t border-border bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
              {remaining} restante{remaining === 1 ? "" : "s"}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
