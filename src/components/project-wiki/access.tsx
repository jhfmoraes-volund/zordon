"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExternalLink, Trash2, Check, X, KeyRound, Pencil } from "lucide-react";
import { useWikiItems } from "@/hooks/use-wiki-items";
import { SectionWrapper } from "./section-wrapper";
import type { AccessItem, SectionProps } from "./types";

export function AccessSection({
  section,
  onUpdate,
  mode = "edit",
  hideHeader,
}: SectionProps) {
  const readOnly = mode === "read";
  const { items, add, remove, replaceItem, adding, setAdding } =
    useWikiItems<AccessItem>(section, onUpdate as (data: AccessItem[]) => Promise<void>);
  const [form, setForm] = useState({
    service: "",
    url: "",
    credentials_hint: "",
    notes: "",
  });
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({
    service: "",
    url: "",
    credentials_hint: "",
    notes: "",
  });

  const handleAdd = () => {
    if (!form.service) return;
    add({ ...form });
    setForm({ service: "", url: "", credentials_hint: "", notes: "" });
    setAdding(false);
  };

  const startEdit = (i: number) => {
    setEditForm({ ...items[i] });
    setEditingIndex(i);
  };

  const confirmEdit = () => {
    if (editingIndex === null || !editForm.service) return;
    replaceItem(editingIndex, { ...editForm });
    setEditingIndex(null);
  };

  return (
    <SectionWrapper
      title={section.title}
      sectionKey="access"
      onAdd={readOnly ? undefined : () => setAdding(!adding)}
      hideHeader={hideHeader}
    >
      <div className="space-y-2">
        {items.map((acc, i) =>
          editingIndex === i ? (
            <div key={i} className="space-y-2 surface-inset px-3 py-2">
              <div className="flex items-end gap-2">
                <Input
                  className="flex-1"
                  value={editForm.service}
                  onChange={(e) =>
                    setEditForm({ ...editForm, service: e.target.value })
                  }
                />
                <Input
                  className="flex-1"
                  placeholder="URL"
                  value={editForm.url}
                  onChange={(e) =>
                    setEditForm({ ...editForm, url: e.target.value })
                  }
                />
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
              <div className="flex gap-2">
                <Input
                  className="flex-1"
                  placeholder="Onde encontrar credenciais (ex: 1Password vault: Volund)"
                  value={editForm.credentials_hint}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      credentials_hint: e.target.value,
                    })
                  }
                />
                <Input
                  className="flex-1"
                  placeholder="Notas"
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm({ ...editForm, notes: e.target.value })
                  }
                />
              </div>
            </div>
          ) : (
            <div
              key={i}
              className="group flex items-center gap-3 surface-inset px-3 py-2"
            >
              <KeyRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium">{acc.service}</span>
              {acc.url && (
                <a
                  href={acc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  Link
                </a>
              )}
              {acc.credentials_hint && (
                <span className="text-xs text-muted-foreground ml-auto">
                  {acc.credentials_hint}
                </span>
              )}
              {acc.notes && (
                <span className="text-xs text-muted-foreground">
                  — {acc.notes}
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
            Nenhum acesso cadastrado.
          </p>
        )}
      </div>

      {adding && (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <div className="grid gap-1 flex-1">
              <Input
                placeholder="Serviço (ex: AWS, Figma, Jira)"
                value={form.service}
                onChange={(e) =>
                  setForm({ ...form, service: e.target.value })
                }
              />
            </div>
            <div className="grid gap-1 flex-1">
              <Input
                placeholder="URL (opcional)"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
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
          <div className="flex gap-2">
            <Input
              className="flex-1"
              placeholder="Onde encontrar credenciais (ex: 1Password vault: Volund)"
              value={form.credentials_hint}
              onChange={(e) =>
                setForm({ ...form, credentials_hint: e.target.value })
              }
            />
            <Input
              className="flex-1"
              placeholder="Notas (opcional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
      )}
    </SectionWrapper>
  );
}
