"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, Check, X, Pencil } from "lucide-react";
import { useWikiItems } from "@/hooks/use-wiki-items";
import { SectionWrapper } from "./section-wrapper";
import type { SponsorItem, SectionProps } from "./types";

export function SponsorsSection({
  section,
  onUpdate,
  mode = "edit",
  hideHeader,
}: SectionProps) {
  const readOnly = mode === "read";
  const { items, add, remove, replaceItem, adding, setAdding } =
    useWikiItems<SponsorItem>(section, onUpdate as (data: SponsorItem[]) => Promise<void>);
  const [form, setForm] = useState({ name: "", role: "", contact: "" });
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", role: "", contact: "" });

  const handleAdd = () => {
    if (!form.name) return;
    add({ ...form });
    setForm({ name: "", role: "", contact: "" });
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
      sectionKey="sponsors"
      onAdd={readOnly ? undefined : () => setAdding(!adding)}
      hideHeader={hideHeader}
    >
      <div className="space-y-2">
        {items.map((sponsor, i) =>
          editingIndex === i ? (
            <div key={i} className="flex items-end gap-2">
              <Input
                className="flex-1"
                value={editForm.name}
                onChange={(e) =>
                  setEditForm({ ...editForm, name: e.target.value })
                }
              />
              <Input
                className="flex-1"
                placeholder="Papel"
                value={editForm.role}
                onChange={(e) =>
                  setEditForm({ ...editForm, role: e.target.value })
                }
              />
              <Input
                className="flex-1"
                placeholder="Contato"
                value={editForm.contact}
                onChange={(e) =>
                  setEditForm({ ...editForm, contact: e.target.value })
                }
              />
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
            <div
              key={i}
              className="group flex items-center gap-3 surface-inset px-3 py-2"
            >
              <div className="flex-1">
                <span className="text-sm font-medium">{sponsor.name}</span>
                {sponsor.role && (
                  <span className="text-sm text-muted-foreground">
                    {" "}
                    — {sponsor.role}
                  </span>
                )}
              </div>
              {sponsor.contact && (
                <span className="text-xs text-muted-foreground">
                  {sponsor.contact}
                </span>
              )}
              {!readOnly && (
                <>
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
                </>
              )}
            </div>
          )
        )}
        {items.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground px-1">
            Nenhum sponsor cadastrado.
          </p>
        )}
      </div>

      {adding && (
        <div className="flex items-end gap-2">
          <div className="grid gap-1 flex-1">
            <Input
              placeholder="Nome"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid gap-1 flex-1">
            <Input
              placeholder="Papel (ex: Product Owner)"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            />
          </div>
          <div className="grid gap-1 flex-1">
            <Input
              placeholder="Contato (email/telefone)"
              value={form.contact}
              onChange={(e) => setForm({ ...form, contact: e.target.value })}
            />
          </div>
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
