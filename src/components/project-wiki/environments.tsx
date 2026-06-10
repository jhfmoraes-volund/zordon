"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExternalLink, Trash2, Check, X, Pencil } from "lucide-react";
import { useWikiItems } from "@/hooks/use-wiki-items";
import { StatusChip } from "@/components/ui/status-chip";
import { ENVIRONMENT, lookupChip } from "@/lib/status-chips";
import { SectionWrapper } from "./section-wrapper";
import { envTypes } from "./constants";
import type { EnvironmentItem, SectionProps } from "./types";

export function EnvironmentsSection({ section, onUpdate }: SectionProps) {
  const { items, add, remove, replaceItem, adding, setAdding } =
    useWikiItems<EnvironmentItem>(section, onUpdate as (data: EnvironmentItem[]) => Promise<void>);
  const [form, setForm] = useState({
    name: "",
    url: "",
    type: "development",
    notes: "",
  });
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    url: "",
    type: "development",
    notes: "",
  });

  const handleAdd = () => {
    if (!form.name) return;
    add({ ...form });
    setForm({ name: "", url: "", type: "development", notes: "" });
    setAdding(false);
  };

  const startEdit = (i: number) => {
    setEditForm({ ...items[i] });
    setEditingIndex(i);
  };

  const confirmEdit = () => {
    if (editingIndex === null || !editForm.name) return;
    replaceItem(editingIndex, { ...editForm });
    setEditingIndex(null);
  };

  return (
    <SectionWrapper
      title={section.title}
      sectionKey="environments"
      onAdd={() => setAdding(!adding)}
    >
      <div className="space-y-2">
        {items.map((env, i) =>
          editingIndex === i ? (
            <div key={i} className="space-y-2 surface-inset px-3 py-2">
              <div className="flex items-end gap-2">
                <Input
                  className="flex-1"
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm({ ...editForm, name: e.target.value })
                  }
                />
                <Input
                  className="flex-[2]"
                  placeholder="URL"
                  value={editForm.url}
                  onChange={(e) =>
                    setEditForm({ ...editForm, url: e.target.value })
                  }
                />
                <Select
                  value={editForm.type}
                  onValueChange={(v) =>
                    v && setEditForm({ ...editForm, type: v })
                  }
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {envTypes.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="icon"
                  className="h-9 w-9"
                  onClick={confirmEdit}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9"
                  onClick={() => setEditingIndex(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <Input
                placeholder="Notas"
                value={editForm.notes}
                onChange={(e) =>
                  setEditForm({ ...editForm, notes: e.target.value })
                }
              />
            </div>
          ) : (
            <div
              key={i}
              className="group flex items-center gap-3 surface-inset px-3 py-2"
            >
              <span className="text-sm font-medium">{env.name}</span>
              {env.url && (
                <a
                  href={env.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  {env.url}
                </a>
              )}
              <span className="ml-auto">
                <StatusChip {...lookupChip(ENVIRONMENT, env.type)} dot />
              </span>
              {env.notes && (
                <span className="text-xs text-muted-foreground">
                  {env.notes}
                </span>
              )}
              <button
                onClick={() => startEdit(i)}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              </button>
              <button
                onClick={() => remove(i)}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
              </button>
            </div>
          )
        )}
        {items.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground px-1">
            Nenhum ambiente cadastrado.
          </p>
        )}
      </div>

      {adding && (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <div className="grid gap-1 flex-1">
              <Input
                placeholder="Nome (ex: Produção)"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="grid gap-1 flex-[2]">
              <Input
                placeholder="URL"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </div>
            <Select
              value={form.type}
              onValueChange={(v) => v && setForm({ ...form, type: v })}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {envTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="icon" className="h-9 w-9" onClick={handleAdd}>
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              onClick={() => setAdding(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Input
            placeholder="Notas (opcional)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      )}
    </SectionWrapper>
  );
}
