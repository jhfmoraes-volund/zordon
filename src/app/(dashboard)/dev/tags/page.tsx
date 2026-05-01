"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TagChip, TagChipOverflow } from "@/components/tags/tag-chip";
import {
  TagPicker,
  type TagPickerOption,
} from "@/components/tags/tag-picker";
import type { ChipTone } from "@/lib/status-chips";
import { DEFAULT_PROJECT_TAGS, pickRandomTone } from "@/lib/task-tags";

const SEED_TAGS: TagPickerOption[] = [
  { id: "t1", name: "Front",     tone: "blue" },
  { id: "t2", name: "Back",      tone: "purple" },
  { id: "t3", name: "Bug",       tone: "red" },
  { id: "t4", name: "Infra",     tone: "slate" },
  { id: "t5", name: "Ops",       tone: "teal" },
  { id: "t6", name: "Tech debt", tone: "amber" },
  { id: "t7", name: "Spike",     tone: "cyan" },
  { id: "t8", name: "Polish",    tone: "pink" },
];

const MOCK_TASKS = [
  { ref: "TSK-001", title: "Login screen empty state",        tagIds: ["t1", "t8"] },
  { ref: "TSK-002", title: "Auth race when refreshing token", tagIds: ["t2", "t3", "t4"] },
  { ref: "TSK-003", title: "Migrate logger to OpenTelemetry", tagIds: ["t4", "t6"] },
  { ref: "TSK-004", title: "Investigate memory leak in worker", tagIds: ["t2", "t3", "t6", "t7"] },
  { ref: "TSK-005", title: "Sprint dashboard shell",          tagIds: ["t1"] },
];

type Variant = "solid" | "notion" | "linear";

const VARIANTS: { id: Variant; title: string; subtitle: string }[] = [
  {
    id: "solid",
    title: "A. Solid",
    subtitle: "bg-tone/15 + border. Mesma linha do status-chip.tsx atual.",
  },
  {
    id: "notion",
    title: "B. Notion-style",
    subtitle: "Pill cinza neutra + bolinha de cor. Sóbrio em densidade alta.",
  },
  {
    id: "linear",
    title: "C. Linear-style",
    subtitle: "Outline com bolinha. Alto contraste em dark mode.",
  },
];

export default function TagSandboxPage() {
  return (
    <div className="container mx-auto max-w-6xl space-y-10 p-6">
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Tags sandbox
          </h1>
          <span className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            DEV
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Três variações visuais pra substituir o campo <code>area</code> de
          task. Escolha a que vai virar produto.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {VARIANTS.map((v) => (
          <PickerCard key={v.id} variant={v.id} title={v.title} subtitle={v.subtitle} />
        ))}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Lista de tasks (preview)</h2>
          <p className="text-sm text-muted-foreground">
            Como ficaria a coluna na <code>tasks-list.tsx</code>. Mostra 2 tags
            + indicador <code>+N</code> quando excede.
          </p>
        </div>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Ref</th>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Solid</th>
                  <th className="px-3 py-2 font-medium">Notion</th>
                  <th className="px-3 py-2 font-medium">Linear</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_TASKS.map((t) => {
                  const tags = t.tagIds
                    .map((id) => SEED_TAGS.find((s) => s.id === id))
                    .filter((s): s is TagPickerOption => Boolean(s));
                  return (
                    <tr key={t.ref} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{t.ref}</td>
                      <td className="px-3 py-2">{t.title}</td>
                      <td className="px-3 py-2">
                        <RowTags tags={tags} variant="solid" />
                      </td>
                      <td className="px-3 py-2">
                        <RowTags tags={tags} variant="notion" />
                      </td>
                      <td className="px-3 py-2">
                        <RowTags tags={tags} variant="linear" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Defaults & paleta</h2>
          <p className="text-sm text-muted-foreground">
            Tags criadas em todo projeto novo + paleta reutilizada do{" "}
            <code>status-chips.ts</code>.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Defaults</CardTitle>
            <CardDescription>
              Seedados na criação do projeto e no backfill da migration{" "}
              <code>area</code> → tags.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {DEFAULT_PROJECT_TAGS.map((t) => (
              <TagChip key={t.name} name={t.name} tone={t.tone} variant="solid" />
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function PickerCard({
  variant,
  title,
  subtitle,
}: {
  variant: Variant;
  title: string;
  subtitle: string;
}) {
  const [tags, setTags] = React.useState<TagPickerOption[]>(SEED_TAGS);
  const [selected, setSelected] = React.useState<string[]>(["t1", "t3"]);

  function handleCreate(name: string, tone: ChipTone): TagPickerOption {
    const created: TagPickerOption = {
      id: `t${Date.now()}`,
      name,
      tone,
    };
    setTags((prev) => [...prev, created]);
    return created;
  }

  function handleRecolor(id: string, tone: ChipTone) {
    setTags((prev) => prev.map((t) => (t.id === id ? { ...t, tone } : t)));
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="text-xs">{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Tags
          </label>
          <TagPicker
            available={tags}
            selectedIds={selected}
            onChange={setSelected}
            onCreate={handleCreate}
            onRecolor={handleRecolor}
            variant={variant}
            triggerVisibleCount={2}
          />
        </div>

        <div className="space-y-2 rounded-md border border-dashed border-border/70 bg-muted/20 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Apresentação compacta
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 6).map((t) => (
              <TagChip key={t.id} name={t.name} tone={t.tone} variant={variant} />
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={() => {
              const next: string[] = [];
              for (let i = 0; i < 10 && i < tags.length; i++) {
                next.push(tags[i].id);
              }
              setSelected(next);
            }}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Forçar 10 (testar limite)
          </button>
          <span className="px-2 text-muted-foreground">•</span>
          <button
            type="button"
            onClick={() => setSelected([])}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Limpar
          </button>
          <span className="px-2 text-muted-foreground">•</span>
          <button
            type="button"
            onClick={() => {
              const created: TagPickerOption = {
                id: `t${Date.now()}`,
                name: `Random-${Math.floor(Math.random() * 999)}`,
                tone: pickRandomTone(),
              };
              setTags((prev) => [...prev, created]);
            }}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Add tag aleatória
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function RowTags({
  tags,
  variant,
}: {
  tags: TagPickerOption[];
  variant: Variant;
}) {
  const VISIBLE = 2;
  const visible = tags.slice(0, VISIBLE);
  const overflow = Math.max(0, tags.length - VISIBLE);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((t) => (
        <TagChip key={t.id} name={t.name} tone={t.tone} variant={variant} />
      ))}
      <TagChipOverflow count={overflow} variant={variant} />
    </div>
  );
}
