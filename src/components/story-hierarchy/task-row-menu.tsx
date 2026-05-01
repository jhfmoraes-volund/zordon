"use client";

import { MoreVertical, Copy, FolderInput, Hash, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

type TaskRowMenuProps = {
  taskRef: string;
  onDuplicate: (taskRef: string) => void;
  onClone: (taskRef: string) => void;
  onCopyRef: (taskRef: string) => void;
  onDelete: (taskRef: string) => void;
};

const stop = (e: React.MouseEvent | React.PointerEvent) =>
  e.stopPropagation();

export function TaskRowMenu({
  taskRef,
  onDuplicate,
  onClone,
  onCopyRef,
  onDelete,
}: TaskRowMenuProps) {
  return (
    <span onClick={stop} onPointerDown={stop} className="inline-flex">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Ações da task"
              className="size-7 text-muted-foreground hover:text-foreground"
            >
              <MoreVertical className="size-3.5" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-[180px]">
          <DropdownMenuItem onClick={() => onDuplicate(taskRef)}>
            <Copy className="size-3.5" />
            Duplicar
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onClone(taskRef)}>
            <FolderInput className="size-3.5" />
            Clonar para projeto…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onCopyRef(taskRef)}>
            <Hash className="size-3.5" />
            Copiar referência
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDelete(taskRef)}
          >
            <Trash2 className="size-3.5" />
            Deletar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
