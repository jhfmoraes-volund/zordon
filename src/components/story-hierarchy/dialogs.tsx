"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Field, FormBody } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Module, Persona } from "./types";

// ─── Module dialog ───────────────────────────────────────────────────────────

type ModuleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, dialog opens in edit mode. Null = create. */
  initial?: Module | null;
  /** Suggested name (ex: from `proposedModuleName` in a story). */
  suggestedName?: string;
  onSubmit: (data: { name: string; description?: string }) => void;
};

const MODULE_NAME_HELP = "Uppercase + underscore. Ex: LOGIN, BILLING, AUDIT_LOG.";

function normalizeModuleName(raw: string): string {
  return raw
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}

export function ModuleDialog({
  open,
  onOpenChange,
  initial,
  suggestedName,
  onSubmit,
}: ModuleDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? suggestedName ?? "");
      setDescription(initial?.description ?? "");
    }
  }, [open, initial, suggestedName]);

  const normalized = normalizeModuleName(name);
  const valid = normalized.length > 0 && /^[A-Z][A-Z0-9_]*$/.test(normalized);

  function submit() {
    if (!valid) return;
    onSubmit({ name: normalized, description: description.trim() || undefined });
    onOpenChange(false);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {initial ? "Editar módulo" : "Novo módulo"}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Módulo é tag de agrupamento por área funcional do produto. Sem
            owner, sem due date.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          <FormBody>
            <Field name="module-name" required>
              <Field.Label>Nome</Field.Label>
              <Field.Control>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="LOGIN"
                  autoFocus
                />
              </Field.Control>
              <Field.Hint>
                {MODULE_NAME_HELP}{" "}
                {name && name !== normalized ? (
                  <>
                    Vai virar:{" "}
                    <span className="font-mono text-foreground">
                      {normalized}
                    </span>
                  </>
                ) : null}
              </Field.Hint>
            </Field>

            <Field name="module-desc">
              <Field.Label>Descrição</Field.Label>
              <Field.Control>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="1-2 frases explicando o escopo funcional"
                  rows={2}
                />
              </Field.Control>
            </Field>
          </FormBody>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!valid}>
            {initial ? "Salvar" : "Criar módulo"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

// ─── Persona dialog ──────────────────────────────────────────────────────────

type PersonaDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Persona | null;
  onSubmit: (data: { name: string; description?: string }) => void;
};

export function PersonaDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
}: PersonaDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setDescription(initial?.description ?? "");
    }
  }, [open, initial]);

  const valid = name.trim().length > 0;

  function submit() {
    if (!valid) return;
    onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
    });
    onOpenChange(false);
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {initial ? "Editar persona" : "Nova persona"}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Persona é a quem a story serve. Use livre — Cliente Premium, Gestor
            de Vendas, etc. Builder/PM/Cliente já vêm de seed.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody>
          <FormBody>
            <Field name="persona-name" required>
              <Field.Label>Nome</Field.Label>
              <Field.Control>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Cliente Premium"
                  autoFocus
                />
              </Field.Control>
            </Field>

            <Field name="persona-desc">
              <Field.Label>Descrição</Field.Label>
              <Field.Control>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Quem é essa pessoa, o que ela busca"
                  rows={2}
                />
              </Field.Control>
            </Field>
          </FormBody>
        </ResponsiveDialogBody>

        <ResponsiveDialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!valid}>
            {initial ? "Salvar" : "Criar persona"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
