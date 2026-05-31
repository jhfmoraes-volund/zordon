"use client";

import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function PageHeader({
  title,
  description,
  onAdd,
  addLabel = "Novo",
}: {
  title: string;
  description?: string;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {onAdd && (
        <Button onClick={onAdd} size="sm" className="w-auto self-start sm:self-auto">
          <Plus className="mr-1 h-4 w-4" />
          {addLabel}
        </Button>
      )}
    </div>
  );
}
