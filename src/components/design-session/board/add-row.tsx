"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACCENT_CLASSES, type Accent } from "./tokens";

type BoardAddRowProps = {
  accent: Accent;
  placeholder: string;
  onAdd: (text: string) => void;
  /** Override the button label. Default: "Adicionar". */
  buttonLabel?: string;
};

export function BoardAddRow({
  accent,
  placeholder,
  onAdd,
  buttonLabel = "Adicionar",
}: BoardAddRowProps) {
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);
  const cls = ACCENT_CLASSES[accent];
  const canSubmit = text.trim().length > 0;

  const handleAdd = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText("");
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleAdd();
      }}
      className="grid grid-cols-[1fr_auto] gap-2"
    >
      <div
        className={cn(
          "flex h-[38px] items-center gap-2.5 rounded-md px-3 pl-3.5 transition-[background-color,box-shadow] duration-150",
          focus
            ? "bg-foreground/[0.05] ring-1 ring-inset ring-[var(--brand)] ring-offset-0 shadow-[0_0_0_3px_oklch(0.637_0.237_22/0.22)]"
            : "bg-foreground/[0.03] ring-1 ring-inset ring-[var(--accent-surface-ring)]",
        )}
      >
        <Plus
          className={cn(
            "size-3.5 shrink-0 transition-colors duration-150",
            focus ? "text-[var(--brand)]" : cls.chip,
          )}
        />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          placeholder={placeholder}
          className="h-full flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <button
        type="submit"
        disabled={!canSubmit}
        className={cn(
          "inline-flex h-[38px] items-center justify-center rounded-md px-4 text-[12.5px] font-medium transition-[background-color,color] duration-150",
          canSubmit
            ? "bg-[var(--brand)] text-primary-foreground hover:bg-[var(--brand)]/90"
            : "cursor-not-allowed bg-foreground/[0.04] text-muted-foreground ring-1 ring-inset ring-[var(--accent-surface-ring)]",
        )}
      >
        {buttonLabel}
      </button>
    </form>
  );
}
