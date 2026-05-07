"use client";

import { Hash, MoreVertical, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

type StoryRowMenuProps = {
  storyRef: string;
  onCopyRef: (storyRef: string) => void;
  onDelete: (storyRef: string) => void;
};

const stop = (e: React.MouseEvent | React.PointerEvent) =>
  e.stopPropagation();

export function StoryRowMenu({
  storyRef,
  onCopyRef,
  onDelete,
}: StoryRowMenuProps) {
  return (
    <span onClick={stop} onPointerDown={stop} className="inline-flex">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Ações da story"
              className="size-7 text-muted-foreground hover:text-foreground"
            >
              <MoreVertical className="size-3.5" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-[180px]">
          <DropdownMenuItem onClick={() => onCopyRef(storyRef)}>
            <Hash className="size-3.5" />
            Copiar referência
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDelete(storyRef)}
          >
            <Trash2 className="size-3.5" />
            Deletar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
