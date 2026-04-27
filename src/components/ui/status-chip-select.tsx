"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusChip, type StatusChipProps } from "./status-chip";
import { lookupChip, type ChipDescriptor } from "@/lib/status-chips";

type StatusChipSelectProps<T extends Record<string, ChipDescriptor>> = {
  value: string | null | undefined;
  options: T;
  onValueChange?: (value: keyof T & string) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: StatusChipProps["size"];
  dot?: boolean;
  className?: string;
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
}: StatusChipSelectProps<T>) {
  return (
    <Select
      value={value ?? undefined}
      onValueChange={(v) => v && onValueChange?.(v as keyof T & string)}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        className={`h-7 w-auto border-none bg-transparent p-0 shadow-none hover:opacity-80 ${className ?? ""}`}
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
