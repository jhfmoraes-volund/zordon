"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Module, Persona } from "./types";

export type StoryCreateInput = {
  title: string;
  want: string;
  soThat?: string;
  personaId: string | null;
  moduleId: string | null;
  proposedModuleName?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modules: Module[];
  personas: Persona[];
  onSubmit: (input: StoryCreateInput) => void | Promise<void>;
};

const MODULE_NEW = "__new__";
const MODULE_NONE = "__none__";

export function StoryCreateDialog({
  open,
  onOpenChange,
  modules,
  personas,
  onSubmit,
}: Props) {
  const [title, setTitle] = useState("");
  const [want, setWant] = useState("");
  const [soThat, setSoThat] = useState("");
  const [personaId, setPersonaId] = useState<string>("");
  const [moduleId, setModuleId] = useState<string>(MODULE_NONE);
  const [proposedModuleName, setProposedModuleName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setWant("");
      setSoThat("");
      setPersonaId(personas[0]?.id ?? "");
      setMod(MODULE_NONE);
      setProposedModuleName("");
      setSubmitting(false);
    }
  }, [open, personas]);

  function setMod(v: string) {
    setModuleId(v);
    if (v !== MODULE_NEW) setProposedModuleName("");
  }

  const valid =
    title.trim().length >= 3 &&
    want.trim().length >= 3 &&
    !!personaId &&
    (moduleId !== MODULE_NEW ||
      /^[A-Z][A-Z0-9_]*$/.test(proposedModuleName.trim()));

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        want: want.trim(),
        soThat: soThat.trim() || undefined,
        personaId,
        moduleId:
          moduleId === MODULE_NEW || moduleId === MODULE_NONE
            ? null
            : moduleId,
        proposedModuleName:
          moduleId === MODULE_NEW ? proposedModuleName.trim() : null,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl gap-0 p-0 flex flex-col"
      >
        <SheetHeader className="border-b px-6 pt-6 pb-4">
          <SheetTitle>Nova user story</SheetTitle>
          <SheetDescription>
            Como persona, quero algo, para que tenha valor de negócio.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-4 px-6 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="story-title">Título</Label>
            <Input
              id="story-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Magic-link com expiração curta"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Persona</Label>
              <Select
                value={personaId}
                onValueChange={(v) => v !== null && setPersonaId(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha persona" />
                </SelectTrigger>
                <SelectContent>
                  {personas.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Módulo</Label>
              <Select
                value={moduleId}
                onValueChange={(v) => v !== null && setMod(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Escolha módulo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MODULE_NONE}>Sem módulo</SelectItem>
                  {modules.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={MODULE_NEW}>+ Propor novo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {moduleId === MODULE_NEW ? (
            <div className="space-y-1.5">
              <Label htmlFor="story-proposed-module">
                Nome proposto (UPPERCASE_SNAKE)
              </Label>
              <Input
                id="story-proposed-module"
                value={proposedModuleName}
                onChange={(e) =>
                  setProposedModuleName(
                    e.target.value
                      .toUpperCase()
                      .replace(/\s+/g, "_")
                      .replace(/[^A-Z0-9_]/g, ""),
                  )
                }
                placeholder="AUDIT_LOG"
              />
              <p className="text-[11px] text-muted-foreground">
                PM precisa aprovar pra virar módulo de fato.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="story-want">Quero…</Label>
            <Textarea
              id="story-want"
              value={want}
              onChange={(e) => setWant(e.target.value)}
              placeholder="receber link de login que expira em 10 min"
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="story-so-that">…para que (opcional)</Label>
            <Textarea
              id="story-so-that"
              value={soThat}
              onChange={(e) => setSoThat(e.target.value)}
              placeholder="reduzir risco de link vazado"
              rows={2}
            />
          </div>
        </div>

        <SheetFooter className="border-t bg-popover px-6 py-3 flex flex-row items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!valid || submitting}>
            {submitting ? "Criando…" : "Criar story"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
