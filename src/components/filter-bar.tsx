"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type FilterOption = { value: string; label: string };

export type FilterDef = {
  key: string;
  label: string;
  options: FilterOption[];
  value: string | null;
  onChange: (value: string | null) => void;
};

const ALL = "__all__";

export function FilterBar({
  filters,
  className,
}: {
  filters: FilterDef[];
  className?: string;
}) {
  const hasActive = filters.some((f) => f.value);
  const clearAll = () => filters.forEach((f) => f.onChange(null));

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {filters.map((f) => (
        <Select
          key={f.key}
          value={f.value ?? ALL}
          onValueChange={(v) => f.onChange(v === ALL ? null : v)}
        >
          <SelectTrigger className="h-8 text-xs min-w-[160px]">
            <SelectValue>
              {(value: string | null) => {
                if (!value || value === ALL) {
                  return (
                    <span className="text-muted-foreground">
                      {f.label}: <span className="text-foreground/70">Todos</span>
                    </span>
                  );
                }
                const match = f.options.find((o) => o.value === value);
                return (
                  <span>
                    <span className="text-muted-foreground">{f.label}:</span>{" "}
                    <span className="font-medium">{match?.label ?? value}</span>
                  </span>
                );
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>
              <span className="text-muted-foreground">Todos</span>
            </SelectItem>
            {f.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {hasActive && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAll}
          className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Limpar
        </Button>
      )}
    </div>
  );
}
