"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExternalLink, Trash2, Check, X, Pencil } from "lucide-react";
import { useWikiItems } from "@/hooks/use-wiki-items";
import { SectionWrapper } from "./section-wrapper";
import { linkCategories } from "./constants";
import type { LinkItem, SectionProps } from "./types";

export function LinksSection({
  section,
  onUpdate,
  mode = "edit",
  hideHeader,
}: SectionProps) {
  const readOnly = mode === "read";
  const { items, add, remove, replaceItem, adding, setAdding } =
    useWikiItems<LinkItem>(section, onUpdate as (data: LinkItem[]) => Promise<void>);
  const [form, setForm] = useState({ label: "", url: "", category: "geral" });
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ label: "", url: "", category: "geral" });

  const handleAdd = () => {
    if (!form.label || !form.url) return;
    add({ ...form });
    setForm({ label: "", url: "", category: "geral" });
    setAdding(false);
  };

  const startEdit = (i: number) => {
    setEditForm({ ...items[i] });
    setEditingIndex(i);
  };

  const confirmEdit = () => {
    if (editingIndex === null || !editForm.label || !editForm.url) return;
    replaceItem(editingIndex, { ...editForm });
    setEditingIndex(null);
  };

  return (
    <SectionWrapper
      title={section.title}
      sectionKey="links"
      onAdd={readOnly ? undefined : () => setAdding(!adding)}
      hideHeader={hideHeader}
    >
      <div className="flex flex-wrap gap-2">
        {items.map((link, i) =>
          editingIndex === i ? (
            <div key={i} className="flex items-end gap-2 w-full">
              <Input
                className="flex-1"
                value={editForm.label}
                onChange={(e) =>
                  setEditForm({ ...editForm, label: e.target.value })
                }
              />
              <Input
                className="flex-[2]"
                value={editForm.url}
                onChange={(e) =>
                  setEditForm({ ...editForm, url: e.target.value })
                }
              />
              <Select
                value={editForm.category}
                onValueChange={(v) =>
                  v && setEditForm({ ...editForm, category: v })
                }
              >
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {linkCategories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="icon" className="h-9 w-9" onClick={confirmEdit}>
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
          ) : (
            <a
              key={i}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/60 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">{link.label}</span>
              {link.category !== "geral" && (
                <Badge variant="secondary" className="text-[10px] h-4">
                  {link.category}
                </Badge>
              )}
              {!readOnly && (
                <>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      startEdit(i);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      remove(i);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground hover:text-red-500" />
                  </button>
                </>
              )}
            </a>
          )
        )}
        {items.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">
            Nenhum link adicionado.
          </p>
        )}
      </div>

      {adding && (
        <div className="flex items-end gap-2">
          <div className="grid gap-1 flex-1">
            <Input
              placeholder="Nome do link"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </div>
          <div className="grid gap-1 flex-[2]">
            <Input
              placeholder="https://..."
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          </div>
          <Select
            value={form.category}
            onValueChange={(v) => v && setForm({ ...form, category: v })}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {linkCategories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
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
      )}
    </SectionWrapper>
  );
}
