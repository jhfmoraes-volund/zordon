"use client";

/**
 * Form de lançamento financeiro (criar/editar) — ResponsiveSheet + Field/FormBody.
 * Os campos seguem a categoria: recorrência (vigência) vs pontual (data), membro
 * obrigatório quando requires_member (Salários). Valores em R$ → centavos.
 *
 * Estado inicial vem de lazy useState (derivado das props); o reset entre
 * aberturas é feito pelo PAI via `key` (remonta) — evita setState em effect.
 */

import { useMemo, useState } from "react";

import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetFooter,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/ui/responsive-sheet";
import { Field, FormBody } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import type {
  Category,
  EntryInput,
  EntryListItem,
  FinanceKind,
  Recurrence,
} from "@/lib/finance/types";

type NamedRef = { id: string; name: string };
const NO_PROJECT = "__none__";

const RECURRENCE_LABEL: Record<Recurrence, string> = {
  once: "Pontual",
  monthly: "Mensal",
  annual: "Anual",
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthISO(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

function deriveInitial(
  entry: EntryListItem | null | undefined,
  categoryOptions: Category[],
  presetCategoryId: string | null | undefined,
) {
  if (entry) {
    return {
      categoryId: entry.category_id,
      amountReais: (entry.amount_cents / 100).toString(),
      recurrence: entry.recurrence,
      occurredOn: entry.occurred_on ?? todayISO(),
      effectiveFrom: entry.effective_from ?? firstOfMonthISO(),
      effectiveTo: entry.effective_to ?? "",
      projectId: entry.project_id ?? NO_PROJECT,
      memberId: entry.member_id ?? "",
      vendor: entry.vendor ?? "",
      description: entry.description ?? "",
    };
  }
  const initial =
    categoryOptions.find((c) => c.id === presetCategoryId) ?? categoryOptions[0];
  return {
    categoryId: initial?.id ?? "",
    amountReais: "",
    recurrence: (initial?.recurring_default ? "monthly" : "once") as Recurrence,
    occurredOn: todayISO(),
    effectiveFrom: firstOfMonthISO(),
    effectiveTo: "",
    projectId: NO_PROJECT,
    memberId: "",
    vendor: "",
    description: "",
  };
}

export function FinanceEntryForm({
  open,
  onOpenChange,
  kind,
  categories,
  projects,
  members,
  entry,
  presetCategoryId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Tipo no modo criar (filtra categorias). Em edição, vem do entry. */
  kind: FinanceKind;
  categories: Category[];
  projects: NamedRef[];
  members: NamedRef[];
  entry?: EntryListItem | null;
  presetCategoryId?: string | null;
  onSaved: () => void;
}) {
  const effectiveKind: FinanceKind = entry ? entry.categoryKind : kind;
  const categoryOptions = useMemo(
    () => categories.filter((c) => c.kind === effectiveKind && !c.archived),
    [categories, effectiveKind],
  );

  const [init] = useState(() => deriveInitial(entry, categoryOptions, presetCategoryId));
  const [categoryId, setCategoryId] = useState(init.categoryId);
  const [amountReais, setAmountReais] = useState(init.amountReais);
  const [recurrence, setRecurrence] = useState<Recurrence>(init.recurrence);
  const [occurredOn, setOccurredOn] = useState(init.occurredOn);
  const [effectiveFrom, setEffectiveFrom] = useState(init.effectiveFrom);
  const [effectiveTo, setEffectiveTo] = useState(init.effectiveTo);
  const [projectId, setProjectId] = useState(init.projectId);
  const [memberId, setMemberId] = useState(init.memberId);
  const [vendor, setVendor] = useState(init.vendor);
  const [description, setDescription] = useState(init.description);
  const [saving, setSaving] = useState(false);

  const selectedCat = categories.find((c) => c.id === categoryId);
  const requiresMember = selectedCat?.requires_member ?? false;
  const recurring = recurrence !== "once";

  const amountCents = Math.round(parseFloat(amountReais.replace(",", ".")) * 100);
  const amountValid = Number.isFinite(amountCents) && amountCents > 0;
  const dateValid = recurring ? !!effectiveFrom : !!occurredOn;
  const canSave =
    !!categoryId && amountValid && dateValid && (!requiresMember || !!memberId) && !saving;

  function onCategoryChange(next: string) {
    setCategoryId(next);
    const cat = categories.find((c) => c.id === next);
    setRecurrence(cat?.recurring_default ? "monthly" : "once");
    if (!cat?.requires_member) setMemberId("");
  }

  async function handleSave() {
    if (!canSave) return;
    const payload: EntryInput = {
      categoryId,
      projectId: projectId === NO_PROJECT ? null : projectId,
      memberId: requiresMember ? memberId : null,
      amountCents,
      recurrence,
      occurredOn: recurring ? null : occurredOn,
      effectiveFrom: recurring ? effectiveFrom : null,
      effectiveTo: recurring && effectiveTo ? effectiveTo : null,
      vendor: vendor.trim() || null,
      description: description.trim() || null,
    };
    setSaving(true);
    try {
      await fetchOrThrow(
        entry ? `/api/finance/entries/${entry.id}` : "/api/finance/entries",
        {
          method: entry ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      onSaved();
      onOpenChange(false);
    } catch (e) {
      showErrorToast(e, {
        label: entry ? "Falha ao salvar lançamento" : "Falha ao criar lançamento",
      });
    } finally {
      setSaving(false);
    }
  }

  const projectField = (
    <Field name="project">
      <Field.Label>Projeto</Field.Label>
      <Field.Control>
        <Select value={projectId} onValueChange={(v) => setProjectId(v ?? NO_PROJECT)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PROJECT}>Operação (sem projeto)</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field.Control>
    </Field>
  );

  const memberField = (
    <Field name="member" required error={!memberId ? "Selecione o membro" : undefined}>
      <Field.Label>Membro</Field.Label>
      <Field.Control>
        <Select value={memberId} onValueChange={(v) => setMemberId(v ?? "")}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione…" />
          </SelectTrigger>
          <SelectContent>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field.Control>
    </Field>
  );

  const title = entry
    ? "Editar lançamento"
    : effectiveKind === "revenue"
      ? "Nova receita"
      : "Nova despesa";

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>{title}</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          <FormBody density="comfortable">
            <Field.Row cols={2}>
              <Field name="category" required>
                <Field.Label>Categoria</Field.Label>
                <Field.Control>
                  <Select value={categoryId} onValueChange={(v) => v && onCategoryChange(v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione…" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoryOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field.Control>
              </Field>

              <Field
                name="amount"
                required
                error={amountReais !== "" && !amountValid ? "Valor inválido" : undefined}
              >
                <Field.Label>Valor (R$)</Field.Label>
                <Field.Control>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={amountReais}
                    onChange={(e) => setAmountReais(e.target.value)}
                    placeholder="0,00"
                  />
                </Field.Control>
                {recurring && <Field.Hint>valor por mês</Field.Hint>}
              </Field>
            </Field.Row>

            <Field.Row cols={recurring ? 3 : 2}>
              <Field name="recurrence" required>
                <Field.Label>Recorrência</Field.Label>
                <Field.Control>
                  <Select value={recurrence} onValueChange={(v) => setRecurrence(v as Recurrence)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["once", "monthly", "annual"] as Recurrence[]).map((r) => (
                        <SelectItem key={r} value={r}>
                          {RECURRENCE_LABEL[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field.Control>
              </Field>

              {recurring ? (
                <>
                  <Field name="from" required>
                    <Field.Label>Início</Field.Label>
                    <Field.Control>
                      <Input
                        type="date"
                        value={effectiveFrom}
                        onChange={(e) => setEffectiveFrom(e.target.value)}
                      />
                    </Field.Control>
                  </Field>
                  <Field name="to">
                    <Field.Label>Fim (opcional)</Field.Label>
                    <Field.Control>
                      <Input
                        type="date"
                        value={effectiveTo}
                        onChange={(e) => setEffectiveTo(e.target.value)}
                      />
                    </Field.Control>
                  </Field>
                </>
              ) : (
                <Field name="date" required>
                  <Field.Label>Data</Field.Label>
                  <Field.Control>
                    <Input
                      type="date"
                      value={occurredOn}
                      onChange={(e) => setOccurredOn(e.target.value)}
                    />
                  </Field.Control>
                </Field>
              )}
            </Field.Row>

            {requiresMember ? (
              <Field.Row cols={2}>
                {projectField}
                {memberField}
              </Field.Row>
            ) : (
              projectField
            )}

            <Field name="vendor">
              <Field.Label>{effectiveKind === "revenue" ? "Fonte" : "Fornecedor"}</Field.Label>
              <Field.Control>
                <Input
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder={
                    effectiveKind === "revenue" ? "Ex: contrato, hora extra" : "Ex: Figma, Vercel"
                  }
                />
              </Field.Control>
            </Field>

            <Field name="description">
              <Field.Label>Descrição</Field.Label>
              <Field.Control>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Observações…"
                  className="min-h-20"
                />
              </Field.Control>
            </Field>
          </FormBody>
        </ResponsiveSheetBody>

        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
