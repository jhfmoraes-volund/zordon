"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip, type StatusChipProps } from "./status-chip";
import {
  lookupChip,
  TONE_DOT,
  TONE_FILL,
  type ChipDescriptor,
} from "@/lib/status-chips";
import { cn } from "@/lib/utils";

/**
 * Two visual modes:
 *
 * - `inline` (default) — trigger is a borderless chip. Use inside table cells,
 *   header rows, and other compact contexts where the chip *is* the field.
 *
 * - `input` — trigger is a full-width tonalized button (h-9, rounded-lg,
 *   hover state). Use inside form FieldBlocks where the field needs the
 *   "weight" of a regular input. Background/border take the tone of the
 *   currently selected option.
 */
type StatusChipSelectVariant = "inline" | "input";

type StatusChipSelectProps<T extends Record<string, ChipDescriptor>> = {
  value: string | null | undefined;
  options: T;
  onValueChange?: (value: keyof T & string) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: StatusChipProps["size"];
  dot?: boolean;
  className?: string;
  variant?: StatusChipSelectVariant;
};

export function StatusChipSelect<T extends Record<string, ChipDescriptor>>({
  value,
  options,
  onValueChange,
  placeholder = "Selecionar…",
  disabled,
  size = "sm",
  dot = true,
  className,
  variant = "inline",
}: StatusChipSelectProps<T>) {
  if (variant === "input") {
    const currentTone = lookupChip(options, value).tone;
    return (
      <Select
        value={value ?? undefined}
        onValueChange={(v) => v && onValueChange?.(v as keyof T & string)}
        disabled={disabled}
      >
        <SelectTrigger
          className={cn(
            "h-9 w-full justify-between rounded-lg border px-2.5 text-sm font-medium transition-colors",
            TONE_FILL[currentTone],
            className,
          )}
        >
          <SelectValue placeholder={placeholder}>
            {(v: string | null) => {
              const key = v ?? value;
              if (!key) return null;
              const desc = lookupChip(options, key);
              return (
                <span className="flex items-center gap-2">
                  {dot ? (
                    <span
                      className={cn("size-2 shrink-0 rounded-full", TONE_DOT[desc.tone])}
                      aria-hidden
                    />
                  ) : null}
                  <span>{desc.label}</span>
                </span>
              );
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(options).map(([key, desc]) => (
            <SelectItem key={key} value={key}>
              <span className="flex items-center gap-2">
                {dot ? (
                  <span
                    className={cn("size-2 shrink-0 rounded-full", TONE_DOT[desc.tone])}
                    aria-hidden
                  />
                ) : null}
                <span>{desc.label}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // ─── Inline (default) ────────────────────────────────────
  return (
    <Select
      value={value ?? undefined}
      onValueChange={(v) => v && onValueChange?.(v as keyof T & string)}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className={cn(
          "h-7 w-auto border-none bg-transparent p-0 shadow-none hover:opacity-80",
          className,
        )}
      >
        <SelectValue placeholder={placeholder}>
          {(v: string | null) => {
            const key = v ?? value;
            if (!key) return null;
            return <StatusChip {...lookupChip(options, key)} size={size} dot={dot} />;
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.entries(options).map(([key, desc]) => (
          <SelectItem key={key} value={key}>
            <StatusChip {...desc} size={size} dot={dot} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
