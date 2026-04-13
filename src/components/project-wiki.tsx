"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ExternalLink, Plus, Trash2, Check, X, Users, Link2,
  Target, Crosshair, Box,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────

type WikiSection = {
  id: string;
  projectId: string;
  sectionKey: string;
  title: string;
  data: string;
  order: number;
};

type SponsorItem = { name: string; role: string; contact: string };
type LinkItem = { label: string; url: string; category: string };
type IndicatorItem = {
  indicator: string;
  target: string;
  current: string;
  status: string; // on_track, attention, at_risk
};
type ObjectiveItem = { objective: string; description: string };
type ScopeItem = { item: string; included: boolean; notes: string };

// ─── Constants ────────────────────────────────────────────

const sectionIcons: Record<string, typeof Users> = {
  sponsors: Users,
  links: Link2,
  success_indicators: Target,
  objectives: Crosshair,
  scope: Box,
};

const indicatorStatusConfig: Record<string, { label: string; color: string }> = {
  on_track: { label: "No caminho", color: "bg-green-100 text-green-800" },
  attention: { label: "Atenção", color: "bg-yellow-100 text-yellow-800" },
  at_risk: { label: "Em risco", color: "bg-red-100 text-red-800" },
};

const linkCategories = ["geral", "design", "gestão", "técnico", "documentação"];

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
      });
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const updateSection = async (sectionKey: string, data: unknown[]) => {
    await fetch(`/api/projects/${projectId}/wiki/${sectionKey}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
  };

  if (loading) {
    return <div className="p-6 text-muted-foreground">Carregando wiki...</div>;
  }

  const linksSection = sections.find((s) => s.sectionKey === "links");
  const otherSections = sections.filter((s) => s.sectionKey !== "links");

  return (
    <div className="space-y-6">
      {/* Links Rápidos — always on top */}
      {linksSection && (
        <LinksSection
          section={linksSection}
          onUpdate={(data) => updateSection("links", data)}
        />
      )}

      {/* Other sections */}
      {otherSections.map((section) => {
        const SectionComponent = sectionComponents[section.sectionKey];
        if (!SectionComponent) return null;
        return (
          <SectionComponent
            key={section.id}
            section={section}
            onUpdate={(data: unknown[]) => updateSection(section.sectionKey, data)}
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
  onAdd: () => void;
}) {
  const Icon = sectionIcons[sectionKey] || Box;
  return (
    <div className="surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onAdd}>
          <Plus className="mr-1 h-3 w-3" />
          Adicionar
        </Button>
      </div>
      {children}
    </div>
  );
}

// ─── Links Section (top bar) ──────────────────────────────

function LinksSection({
  section,
  onUpdate,
}: {
  section: WikiSection;
  onUpdate: (data: LinkItem[]) => void;
}) {
  const [items, setItems] = useState<LinkItem[]>(() => {
    try { return JSON.parse(section.data); } catch { return []; }
  });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: "", url: "", category: "geral" });

  const save = (updated: LinkItem[]) => {
    setItems(updated);
    onUpdate(updated);
  };

  const add = () => {
    if (!form.label || !form.url) return;
    save([...items, { ...form }]);
    setForm({ label: "", url: "", category: "geral" });
    setAdding(false);
  };

  const remove = (index: number) => {
    save(items.filter((_, i) => i !== index));
  };

  return (
    <div className="surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Links Rápidos</h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setAdding(!adding)}
        >
          <Plus className="mr-1 h-3 w-3" />
          Adicionar
        </Button>
      </div>

      {/* Link cards */}
      <div className="flex flex-wrap gap-2">
        {items.map((link, i) => (
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
                remove(i);
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="h-3 w-3 text-muted-foreground hover:text-red-500" />
            </button>
          </a>
        ))}
        {items.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">Nenhum link adicionado.</p>
        )}
      </div>

      {/* Add form */}
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
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="icon" className="h-9 w-9" onClick={add}>
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
    </div>
  );
}

// ─── Sponsors Section ─────────────────────────────────────

function SponsorsSection({
  section,
  onUpdate,
}: {
  section: WikiSection;
  onUpdate: (data: SponsorItem[]) => void;
}) {
  const [items, setItems] = useState<SponsorItem[]>(() => {
    try { return JSON.parse(section.data); } catch { return []; }
  });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", role: "", contact: "" });

  const save = (updated: SponsorItem[]) => {
    setItems(updated);
    onUpdate(updated);
  };

  const add = () => {
    if (!form.name) return;
    save([...items, { ...form }]);
    setForm({ name: "", role: "", contact: "" });
    setAdding(false);
  };

  const remove = (index: number) => {
    save(items.filter((_, i) => i !== index));
  };

  return (
    <SectionWrapper
      title={section.title}
      sectionKey={section.sectionKey}
      onAdd={() => setAdding(!adding)}
    >
      <div className="space-y-2">
        {items.map((sponsor, i) => (
          <div
            key={i}
            className="group flex items-center gap-3 surface-inset px-3 py-2"
          >
            <div className="flex-1">
              <span className="text-sm font-medium">{sponsor.name}</span>
              {sponsor.role && (
                <span className="text-sm text-muted-foreground"> — {sponsor.role}</span>
              )}
            </div>
            {sponsor.contact && (
              <span className="text-xs text-muted-foreground">{sponsor.contact}</span>
            )}
            <button
              onClick={() => remove(i)}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
            </button>
          </div>
        ))}
        {items.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground px-1">Nenhum sponsor cadastrado.</p>
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
          <Button size="icon" className="h-9 w-9" onClick={add}>
            <Check className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setAdding(false)}>
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
  onUpdate: (data: IndicatorItem[]) => void;
}) {
  const [items, setItems] = useState<IndicatorItem[]>(() => {
    try { return JSON.parse(section.data); } catch { return []; }
  });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    indicator: "", target: "", current: "", status: "on_track",
  });

  const save = (updated: IndicatorItem[]) => {
    setItems(updated);
    onUpdate(updated);
  };

  const add = () => {
    if (!form.indicator) return;
    save([...items, { ...form }]);
    setForm({ indicator: "", target: "", current: "", status: "on_track" });
    setAdding(false);
  };

  const remove = (index: number) => {
    save(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: string, value: string) => {
    const updated = items.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    );
    save(updated);
  };

  return (
    <SectionWrapper
      title={section.title}
      sectionKey={section.sectionKey}
      onAdd={() => setAdding(!adding)}
    >
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((ind, i) => {
            const cfg = indicatorStatusConfig[ind.status] || indicatorStatusConfig.on_track;
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
                    Meta: <span className="font-medium text-foreground">{ind.target}</span>
                  </div>
                  <div className="text-muted-foreground">
                    Atual:{" "}
                    <input
                      className="font-medium text-foreground bg-transparent border-b border-dashed border-muted-foreground/30 w-16 text-center focus:outline-none focus:border-primary"
                      value={ind.current}
                      onChange={(e) => updateItem(i, "current", e.target.value)}
                    />
                  </div>
                  <Select
                    value={ind.status}
                    onValueChange={(v) => v && updateItem(i, "status", v)}
                  >
                    <SelectTrigger className="h-6 w-[110px] text-xs">
                      <SelectValue>
                        <Badge variant="secondary" className={`text-[10px] ${cfg.color}`}>
                          {cfg.label}
                        </Badge>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(indicatorStatusConfig).map(([key, c]) => (
                        <SelectItem key={key} value={key}>
                          <Badge variant="secondary" className={`text-[10px] ${c.color}`}>
                            {c.label}
                          </Badge>
                        </SelectItem>
                      ))}
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
        <p className="text-sm text-muted-foreground px-1">Nenhum indicador cadastrado.</p>
      )}

      {adding && (
        <div className="flex items-end gap-2">
          <div className="grid gap-1 flex-[2]">
            <Input
              placeholder="Indicador (ex: NPS > 80)"
              value={form.indicator}
              onChange={(e) => setForm({ ...form, indicator: e.target.value })}
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
              onChange={(e) => setForm({ ...form, current: e.target.value })}
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
                <SelectItem key={key} value={key}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="icon" className="h-9 w-9" onClick={add}>
            <Check className="h-4 w-4" />
          </Button>
          <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setAdding(false)}>
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
  onUpdate: (data: ObjectiveItem[]) => void;
}) {
  const [items, setItems] = useState<ObjectiveItem[]>(() => {
    try { return JSON.parse(section.data); } catch { return []; }
  });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ objective: "", description: "" });

  const save = (updated: ObjectiveItem[]) => {
    setItems(updated);
    onUpdate(updated);
  };

  const add = () => {
    if (!form.objective) return;
    save([...items, { ...form }]);
    setForm({ objective: "", description: "" });
    setAdding(false);
  };

  const remove = (index: number) => {
    save(items.filter((_, i) => i !== index));
  };

  const updateDescription = (index: number, description: string) => {
    const updated = items.map((item, i) =>
      i === index ? { ...item, description } : item
    );
    save(updated);
  };

  return (
    <SectionWrapper
      title={section.title}
      sectionKey={section.sectionKey}
      onAdd={() => setAdding(!adding)}
    >
      <div className="space-y-2">
        {items.map((obj, i) => (
          <div
            key={i}
            className="group surface-inset px-3 py-2 space-y-1"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium flex-1">{obj.objective}</span>
              <button
                onClick={() => remove(i)}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
              </button>
            </div>
            <Textarea
              value={obj.description}
              onChange={(e) => updateDescription(i, e.target.value)}
              rows={2}
              placeholder="Detalhes do objetivo..."
              className="text-xs resize-none"
            />
          </div>
        ))}
        {items.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground px-1">Nenhum objetivo cadastrado.</p>
        )}
      </div>

      {adding && (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <div className="grid gap-1 flex-1">
              <Input
                placeholder="Objetivo (ex: Lançar MVP até Junho)"
                value={form.objective}
                onChange={(e) => setForm({ ...form, objective: e.target.value })}
              />
            </div>
            <Button size="icon" className="h-9 w-9" onClick={add}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setAdding(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Textarea
            placeholder="Descrição (opcional)"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            className="text-xs resize-none"
          />
        </div>
      )}
    </SectionWrapper>
  );
}

// ─── Scope Section ────────────────────────────────────────

function ScopeSection({
  section,
  onUpdate,
}: {
  section: WikiSection;
  onUpdate: (data: ScopeItem[]) => void;
}) {
  const [items, setItems] = useState<ScopeItem[]>(() => {
    try { return JSON.parse(section.data); } catch { return []; }
  });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ item: "", included: true, notes: "" });

  const save = (updated: ScopeItem[]) => {
    setItems(updated);
    onUpdate(updated);
  };

  const add = () => {
    if (!form.item) return;
    save([...items, { ...form }]);
    setForm({ item: "", included: true, notes: "" });
    setAdding(false);
  };

  const remove = (index: number) => {
    save(items.filter((_, i) => i !== index));
  };

  const toggleIncluded = (index: number) => {
    const updated = items.map((item, i) =>
      i === index ? { ...item, included: !item.included } : item
    );
    save(updated);
  };

  return (
    <SectionWrapper
      title={section.title}
      sectionKey={section.sectionKey}
      onAdd={() => setAdding(!adding)}
    >
      <div className="space-y-2">
        {items.map((scope, i) => (
          <div
            key={i}
            className="group flex items-center gap-3 surface-inset px-3 py-2"
          >
            <button
              onClick={() => toggleIncluded(i)}
              className={`shrink-0 text-sm font-medium ${
                scope.included ? "text-green-600" : "text-red-500"
              }`}
              title={scope.included ? "Incluído no escopo" : "Fora do escopo"}
            >
              {scope.included ? (
                <Check className="h-4 w-4" />
              ) : (
                <X className="h-4 w-4" />
              )}
            </button>
            <div className="flex-1 min-w-0">
              <span
                className={`text-sm font-medium ${
                  !scope.included ? "text-muted-foreground line-through" : ""
                }`}
              >
                {scope.item}
              </span>
              {scope.notes && (
                <span className="text-xs text-muted-foreground ml-2">
                  — {scope.notes}
                </span>
              )}
            </div>
            <Badge
              variant="secondary"
              className={`text-[10px] ${
                scope.included
                  ? "bg-green-100 text-green-800"
                  : "bg-red-100 text-red-800"
              }`}
            >
              {scope.included ? "Incluso" : "Fora"}
            </Badge>
            <button
              onClick={() => remove(i)}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
            </button>
          </div>
        ))}
        {items.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground px-1">Nenhum item de escopo cadastrado.</p>
        )}
      </div>

      {adding && (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <div className="grid gap-1 flex-[2]">
              <Input
                placeholder="Item de escopo (ex: Módulo de Pagamentos)"
                value={form.item}
                onChange={(e) => setForm({ ...form, item: e.target.value })}
              />
            </div>
            <Select
              value={form.included ? "in" : "out"}
              onValueChange={(v) => v && setForm({ ...form, included: v === "in" })}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="in">Incluso</SelectItem>
                <SelectItem value="out">Fora</SelectItem>
              </SelectContent>
            </Select>
            <Button size="icon" className="h-9 w-9" onClick={add}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-9 w-9" onClick={() => setAdding(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Input
            placeholder="Observações (opcional)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      )}
    </SectionWrapper>
  );
}

// ─── Section Component Map ────────────────────────────────

const sectionComponents: Record<
  string,
  React.ComponentType<{ section: WikiSection; onUpdate: (data: unknown[]) => void }>
> = {
  sponsors: SponsorsSection as React.ComponentType<{ section: WikiSection; onUpdate: (data: unknown[]) => void }>,
  success_indicators: IndicatorsSection as React.ComponentType<{ section: WikiSection; onUpdate: (data: unknown[]) => void }>,
  objectives: ObjectivesSection as React.ComponentType<{ section: WikiSection; onUpdate: (data: unknown[]) => void }>,
  scope: ScopeSection as React.ComponentType<{ section: WikiSection; onUpdate: (data: unknown[]) => void }>,
};
