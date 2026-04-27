"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ExternalLink,
  Plus,
  Trash2,
  Check,
  X,
  Users,
  Link2,
  Target,
  Crosshair,
  Box,
  FileText,
  Server,
  KeyRound,
  Pencil,
} from "lucide-react";
import { useWikiItems } from "@/hooks/use-wiki-items";
import { TiptapEditor } from "@/components/tiptap-editor";
import { StatusChip } from "@/components/ui/status-chip";
import { ENVIRONMENT, lookupChip } from "@/lib/status-chips";

// ─── Types ────────────────────────────────────────────────

type WikiSection = {
  id: string;
  projectId: string;
  sectionKey: string;
  title: string;
  data: unknown;
  order: number;
};

type SponsorItem = { name: string; role: string; contact: string };
type LinkItem = { label: string; url: string; category: string };
type IndicatorItem = {
  indicator: string;
  target: string;
  current: string;
  status: string;
};
type ObjectiveItem = { objective: string; description: string };
type EnvironmentItem = {
  name: string;
  url: string;
  type: string;
  notes: string;
};
type AccessItem = {
  service: string;
  url: string;
  credentials_hint: string;
  notes: string;
};

// ─── Constants ────────────────────────────────────────────

const SECTION_ORDER = [
  "description",
  "links",
  "sponsors",
  "objectives",
  "success_indicators",
  "environments",
  "access",
];

const SECTION_TITLES: Record<string, string> = {
  description: "Descrição do Projeto",
  links: "Links Rápidos",
  sponsors: "Sponsors",
  success_indicators: "KPIs / Métricas",
  objectives: "Objetivos",
  environments: "Ambientes",
  access: "Acessos",
};

const sectionIcons: Record<string, typeof Users> = {
  description: FileText,
  sponsors: Users,
  links: Link2,
  success_indicators: Target,
  objectives: Crosshair,
  environments: Server,
  access: KeyRound,
};

const indicatorStatusConfig: Record<
  string,
  { label: string; color: string }
> = {
  on_track: { label: "No caminho", color: "bg-green-100 text-green-800" },
  attention: { label: "Atenção", color: "bg-yellow-100 text-yellow-800" },
  at_risk: { label: "Em risco", color: "bg-red-100 text-red-800" },
};

const linkCategories = ["geral", "design", "gestão", "técnico", "documentação"];
const envTypes = ["development", "staging", "production", "sandbox"];

// ─── Main Component ───────────────────────────────────────

export function ProjectWiki({ projectId }: { projectId: string }) {
  const [sections, setSections] = useState<WikiSection[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/projects/${projectId}/wiki`)
      .then((r) => r.json())
      .then((data) => {
        setSections(data);
        setLoading(false);
      })
      .catch(() => {
        toast.error("Erro ao carregar wiki");
        setLoading(false);
      });
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const updateSection = useCallback(
    async (sectionKey: string, data: unknown) => {
      const res = await fetch(
        `/api/projects/${projectId}/wiki/${sectionKey}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data }),
        }
      );
      if (!res.ok) throw new Error("Failed to save");
    },
    [projectId]
  );

  if (loading) {
    return (
      <div className="p-6 text-muted-foreground">Carregando wiki...</div>
    );
  }

  // Sort sections by SECTION_ORDER
  const sorted = [...sections].sort((a, b) => {
    const ai = SECTION_ORDER.indexOf(a.sectionKey);
    const bi = SECTION_ORDER.indexOf(b.sectionKey);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <div className="space-y-6">
      {sorted.map((section) => {
        const Component = sectionComponentMap[section.sectionKey];
        if (!Component) return null;
        return (
          <Component
            key={section.id}
            section={section}
            onUpdate={(data: unknown) => updateSection(section.sectionKey, data)}
          />
        );
      })}
    </div>
  );
}

// ─── Section Wrapper ──────────────────────────────────────

function SectionWrapper({
  title,
  sectionKey,
  children,
  onAdd,
}: {
  title: string;
  sectionKey: string;
  children: React.ReactNode;
  onAdd?: () => void;
}) {
  const Icon = sectionIcons[sectionKey] || Box;
  const displayTitle = SECTION_TITLES[sectionKey] || title;
  return (
    <div className="surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{displayTitle}</h3>
        </div>
        {onAdd && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onAdd}
          >
            <Plus className="mr-1 h-3 w-3" />
            Adicionar
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Description Section (Tiptap) ────────────────────────

function DescriptionSection({
  section,
  onUpdate,
}: {
  section: WikiSection;
  onUpdate: (data: unknown) => Promise<void>;
}) {
  const data = section.data as { html?: string } | null;
  const initialHtml = data?.html || "";

  const handleUpdate = useCallback(
    async (html: string) => {
      try {
        await onUpdate({ html });
        toast.success("Salvo", { id: "wiki-save" });
      } catch {
        toast.error("Erro ao salvar", { id: "wiki-save" });
      }
    },
    [onUpdate]
  );

  return (
    <SectionWrapper title={section.title} sectionKey="description">
      <TiptapEditor
        content={initialHtml}
        onUpdate={handleUpdate}
        placeholder="Descreva o projeto — visão geral, contexto, motivação..."
      />
    </SectionWrapper>
  );
}

// ─── Links Section ────────────────────────────────────────

function LinksSection({
  section,
  onUpdate,
}: {
  section: WikiSection;
  onUpdate: (data: unknown) => Promise<void>;
}) {
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
      onAdd={() => setAdding(!adding)}
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

// ─── Sponsors Section ─────────────────────────────────────

function SponsorsSection({
  section,
  onUpdate,
}: {
  section: WikiSection;
  onUpdate: (data: unknown) => Promise<void>;
}) {
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
      onAdd={() => setAdding(!adding)}
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

// ─── Indicators Section ───────────────────────────────────

function IndicatorsSection({
  section,
  onUpdate,
}: {
  section: WikiSection;
  onUpdate: (data: unknown) => Promise<void>;
}) {
  const { items, add, remove, updateItem, adding, setAdding } =
    useWikiItems<IndicatorItem>(section, onUpdate as (data: IndicatorItem[]) => Promise<void>);
  const [form, setForm] = useState({
    indicator: "",
    target: "",
    current: "",
    status: "on_track",
  });

  const handleAdd = () => {
    if (!form.indicator) return;
    add({ ...form });
    setForm({ indicator: "", target: "", current: "", status: "on_track" });
    setAdding(false);
  };

  return (
    <SectionWrapper
      title={section.title}
      sectionKey="success_indicators"
      onAdd={() => setAdding(!adding)}
    >
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((ind, i) => {
            const cfg =
              indicatorStatusConfig[ind.status] ||
              indicatorStatusConfig.on_track;
            return (
              <div
                key={i}
                className="group flex items-center gap-3 surface-inset px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{ind.indicator}</span>
                </div>
                <div className="flex items-center gap-3 text-xs shrink-0">
                  <div className="text-muted-foreground">
                    Meta:{" "}
                    <span className="font-medium text-foreground">
                      {ind.target}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    Atual:{" "}
                    <input
                      className="font-medium text-foreground bg-transparent border-b border-dashed border-muted-foreground/30 w-16 text-center focus:outline-none focus:border-primary"
                      value={ind.current}
                      onChange={(e) =>
                        updateItem(i, { current: e.target.value })
                      }
                    />
                  </div>
                  <Select
                    value={ind.status}
                    onValueChange={(v) =>
                      v && updateItem(i, { status: v })
                    }
                  >
                    <SelectTrigger className="h-6 w-[110px] text-xs">
                      <SelectValue>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] ${cfg.color}`}
                        >
                          {cfg.label}
                        </Badge>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(indicatorStatusConfig).map(
                        ([key, c]) => (
                          <SelectItem key={key} value={key}>
                            <Badge
                              variant="secondary"
                              className={`text-[10px] ${c.color}`}
                            >
                              {c.label}
                            </Badge>
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <button
                  onClick={() => remove(i)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {items.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground px-1">
          Nenhum indicador cadastrado.
        </p>
      )}

      {adding && (
        <div className="flex items-end gap-2">
          <div className="grid gap-1 flex-[2]">
            <Input
              placeholder="Indicador (ex: NPS > 80)"
              value={form.indicator}
              onChange={(e) =>
                setForm({ ...form, indicator: e.target.value })
              }
            />
          </div>
          <div className="grid gap-1 flex-1">
            <Input
              placeholder="Meta"
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
            />
          </div>
          <div className="grid gap-1 flex-1">
            <Input
              placeholder="Atual"
              value={form.current}
              onChange={(e) =>
                setForm({ ...form, current: e.target.value })
              }
            />
          </div>
          <Select
            value={form.status}
            onValueChange={(v) => v && setForm({ ...form, status: v })}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(indicatorStatusConfig).map(([key, c]) => (
                <SelectItem key={key} value={key}>
                  {c.label}
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

// ─── Objectives Section ───────────────────────────────────

function ObjectivesSection({
  section,
  onUpdate,
}: {
  section: WikiSection;
  onUpdate: (data: unknown) => Promise<void>;
}) {
  const { items, add, remove, updateItem, replaceItem, adding, setAdding } =
    useWikiItems<ObjectiveItem>(section, onUpdate as (data: ObjectiveItem[]) => Promise<void>);
  const [form, setForm] = useState({ objective: "", description: "" });
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ objective: "", description: "" });

  const handleAdd = () => {
    if (!form.objective) return;
    add({ ...form });
    setForm({ objective: "", description: "" });
    setAdding(false);
  };

  const startEdit = (i: number) => {
    setEditForm({ ...items[i] });
    setEditingIndex(i);
  };

  const confirmEdit = () => {
    if (editingIndex === null || !editForm.objective) return;
    replaceItem(editingIndex, { ...editForm });
    setEditingIndex(null);
  };

  return (
    <SectionWrapper
      title={section.title}
      sectionKey="objectives"
      onAdd={() => setAdding(!adding)}
    >
      <div className="space-y-2">
        {items.map((obj, i) =>
          editingIndex === i ? (
            <div key={i} className="space-y-2 surface-inset px-3 py-2">
              <div className="flex items-end gap-2">
                <Input
                  className="flex-1"
                  value={editForm.objective}
                  onChange={(e) =>
                    setEditForm({ ...editForm, objective: e.target.value })
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
              <Textarea
                value={editForm.description}
                onChange={(e) =>
                  setEditForm({ ...editForm, description: e.target.value })
                }
                rows={2}
                className="text-xs resize-none"
              />
            </div>
          ) : (
            <div key={i} className="group surface-inset px-3 py-2 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium flex-1">
                  {obj.objective}
                </span>
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
              {obj.description && (
                <p className="text-xs text-muted-foreground">
                  {obj.description}
                </p>
              )}
            </div>
          )
        )}
        {items.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground px-1">
            Nenhum objetivo cadastrado.
          </p>
        )}
      </div>

      {adding && (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <div className="grid gap-1 flex-1">
              <Input
                placeholder="Objetivo (ex: Lançar MVP até Junho)"
                value={form.objective}
                onChange={(e) =>
                  setForm({ ...form, objective: e.target.value })
                }
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
          <Textarea
            placeholder="Descrição (opcional)"
            value={form.description}
            onChange={(e) =>
              setForm({ ...form, description: e.target.value })
            }
            rows={2}
            className="text-xs resize-none"
          />
        </div>
      )}
    </SectionWrapper>
  );
}

// ─── Environments Section ─────────────────────────────────

function EnvironmentsSection({
  section,
  onUpdate,
}: {
  section: WikiSection;
  onUpdate: (data: unknown) => Promise<void>;
}) {
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

// ─── Access Section ───────────────────────────────────────

function AccessSection({
  section,
  onUpdate,
}: {
  section: WikiSection;
  onUpdate: (data: unknown) => Promise<void>;
}) {
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
      onAdd={() => setAdding(!adding)}
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

// ─── Section Component Map ────────────────────────────────

type SectionProps = {
  section: WikiSection;
  onUpdate: (data: unknown) => Promise<void>;
};

const sectionComponentMap: Record<
  string,
  React.ComponentType<SectionProps>
> = {
  description: DescriptionSection,
  links: LinksSection as React.ComponentType<SectionProps>,
  sponsors: SponsorsSection as React.ComponentType<SectionProps>,
  success_indicators: IndicatorsSection as React.ComponentType<SectionProps>,
  objectives: ObjectivesSection as React.ComponentType<SectionProps>,
  environments: EnvironmentsSection as React.ComponentType<SectionProps>,
  access: AccessSection as React.ComponentType<SectionProps>,
};
