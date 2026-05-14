"use client";

import * as React from "react";
import { Check, FolderKanban, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProjectPickerOption = {
  id: string;
  name: string;
  hasActiveSprint?: boolean;
};

export type ProjectPickerProps = {
  available: ProjectPickerOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void | Promise<void>;
  mode?: "single" | "multi";
  max?: number;
  disabled?: boolean;
  placeholder?: string;
  emptyText?: string;
  /** When true, items without an active sprint show a "(sem sprint ativa)" hint.
   *  Useful for super_planning meetings; ignored otherwise. */
  showSprintHint?: boolean;
  triggerVisibleCount?: number;
};

export function ProjectPicker({
  available,
  selectedIds,
  onChange,
  mode = "multi",
  max = 50,
  disabled = false,
  placeholder = "Selecionar projeto",
  emptyText = "Nenhum projeto disponível",
  showSprintHint = false,
  triggerVisibleCount = 2,
}: ProjectPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [pendingIds, setPendingIds] = React.useState<string[] | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setPendingIds(null);
  }, [selectedIds]);

  const effectiveIds = pendingIds ?? selectedIds;

  const commit = React.useCallback(
    (nextIds: string[]) => {
      setPendingIds(nextIds);
      void (async () => {
        try {
          await onChange(nextIds);
        } catch {
          setPendingIds(null);
        }
      })();
    },
    [onChange],
  );

  React.useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
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
      effectiveIds
        .map((id) => available.find((p) => p.id === id))
        .filter((p): p is ProjectPickerOption => Boolean(p)),
    [effectiveIds, available],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter((p) => p.name.toLowerCase().includes(q));
  }, [query, available]);

  const atLimit = mode === "multi" && selected.length >= max;

  function selectSingle(id: string) {
    commit([id]);
    setOpen(false);
  }

  function toggleMulti(id: string) {
    if (effectiveIds.includes(id)) {
      commit(effectiveIds.filter((s) => s !== id));
    } else {
      if (atLimit) return;
      commit([...effectiveIds, id]);
    }
  }

  function removeOne(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    commit(effectiveIds.filter((s) => s !== id));
  }

  const visible = selected.slice(0, triggerVisibleCount);
  const overflow = Math.max(0, selected.length - triggerVisibleCount);

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "flex min-h-9 w-full cursor-pointer flex-wrap items-center gap-1.5 rounded-lg border border-input bg-transparent px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/30",
          open && "ring-3 ring-ring/50 border-ring",
          disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
        )}
      >
        {selected.length === 0 ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <FolderKanban className="size-3.5" />
            {placeholder}
          </span>
        ) : mode === "single" ? (
          <span className="flex items-center gap-1.5">
            <FolderKanban className="size-3.5 text-muted-foreground" />
            <span className="truncate">{selected[0].name}</span>
            {showSprintHint && selected[0].hasActiveSprint === false && (
              <span className="text-xs text-muted-foreground">
                (sem sprint ativa)
              </span>
            )}
          </span>
        ) : (
          <>
            {visible.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs text-foreground"
              >
                <span className="max-w-[140px] truncate">{p.name}</span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={(e) => removeOne(p.id, e)}
                    className="rounded p-0.5 hover:bg-foreground/10"
                    aria-label={`Remover ${p.name}`}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </span>
            ))}
            {overflow > 0 && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                +{overflow}
              </span>
            )}
          </>
        )}
        {mode === "multi" && (
          <span className="ml-auto self-center pl-2 text-[10px] text-muted-foreground">
            {selected.length}
            {max < 50 ? `/${max}` : ""}
          </span>
        )}
      </div>

      {open && !disabled ? (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 w-full min-w-[240px] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10">
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
                    if (mode === "single") selectSingle(filtered[0].id);
                    else toggleMulti(filtered[0].id);
                  }
                }
              }}
              placeholder="Buscar projeto"
              className="w-full bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="max-h-[260px] overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                {query.trim() ? "Nada encontrado" : emptyText}
              </div>
            ) : null}

            {filtered.map((p) => {
              const checked = effectiveIds.includes(p.id);
              const disabledItem = mode === "multi" && !checked && atLimit;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={disabledItem}
                  onClick={() =>
                    mode === "single" ? selectSingle(p.id) : toggleMulti(p.id)
                  }
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-sm outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40",
                    checked && mode === "single" && "bg-accent/60",
                  )}
                >
                  <FolderKanban
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="flex-1 truncate text-left">{p.name}</span>
                  {showSprintHint && p.hasActiveSprint === false && (
                    <span className="text-[10px] text-muted-foreground">
                      sem sprint
                    </span>
                  )}
                  {checked ? (
                    <Check className="size-3.5 text-foreground/70" />
                  ) : null}
                </button>
              );
            })}
          </div>

          {mode === "multi" && atLimit ? (
            <div className="border-t border-border bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
              Limite de {max} projetos atingido
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
