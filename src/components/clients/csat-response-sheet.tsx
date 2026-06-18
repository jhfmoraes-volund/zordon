"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetFooter,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FormBody } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import type { CsatResponse } from "@/lib/supabase/types";

export type CsatMember = { id: string; name: string };

export type CsatFormValues = {
  interviewedAt: string; // YYYY-MM-DD
  interviewedBy: string | null;
  contactName: string;
  methodologyScore: string;
  teamScore: string;
  csatScore: string;
  npsScore: string;
  whatsGood: string;
  whatsToImprove: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: CsatMember[];
  currentMemberId: string | null;
  /** Pré-preencher para edição. `null` = novo. */
  existing: CsatResponse | null;
  onSubmit: (values: CsatFormValues) => Promise<void> | void;
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(currentMemberId: string | null): CsatFormValues {
  return {
    interviewedAt: todayISO(),
    interviewedBy: currentMemberId,
    contactName: "",
    methodologyScore: "",
    teamScore: "",
    csatScore: "",
    npsScore: "",
    whatsGood: "",
    whatsToImprove: "",
  };
}

function fromExisting(r: CsatResponse): CsatFormValues {
  return {
    interviewedAt: r.interviewedAt.slice(0, 10),
    interviewedBy: r.interviewedBy,
    contactName: r.contactName ?? "",
    methodologyScore: String(r.methodologyScore),
    teamScore: String(r.teamScore),
    csatScore: String(r.csatScore),
    npsScore: String(r.npsScore),
    whatsGood: r.whatsGood ?? "",
    whatsToImprove: r.whatsToImprove ?? "",
  };
}

function isScoreValid(raw: string): boolean {
  if (raw === "") return false;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 10;
}

export function CsatResponseSheet({
  open,
  onOpenChange,
  members,
  currentMemberId,
  existing,
  onSubmit,
}: Props) {
  const [form, setForm] = useState<CsatFormValues>(() =>
    existing ? fromExisting(existing) : emptyForm(currentMemberId),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(existing ? fromExisting(existing) : emptyForm(currentMemberId));
  }, [open, existing, currentMemberId]);

  const scoresValid =
    isScoreValid(form.methodologyScore) &&
    isScoreValid(form.teamScore) &&
    isScoreValid(form.csatScore) &&
    isScoreValid(form.npsScore);

  const canSubmit = !!form.interviewedAt && scoresValid && !saving;

  async function handleSubmit() {
    if (!canSubmit) return;
    try {
      setSaving(true);
      await onSubmit(form);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>
            {existing ? "Editar entrevista" : "Nova entrevista CSAT"}
          </ResponsiveSheetTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Notas de 0 a 10. Campos de texto opcionais.
          </p>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          <FormBody>
            <Field.Row cols={2}>
              <Field name="interviewedAt" required>
                <Field.Label>Data</Field.Label>
                <Field.Control>
                  <DatePicker
                    data-slot="button"
                    value={form.interviewedAt}
                    onChange={(iso) =>
                      setForm({ ...form, interviewedAt: iso })
                    }
                  />
                </Field.Control>
              </Field>
              <Field name="interviewedBy">
                <Field.Label>Entrevistador</Field.Label>
                <Field.Control>
                  <Select
                    value={form.interviewedBy ?? "__none"}
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        interviewedBy: v === "__none" ? null : v,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">—</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field.Control>
              </Field>
            </Field.Row>

            <Field name="contactName">
              <Field.Label>Contato entrevistado</Field.Label>
              <Field.Control>
                <Input
                  placeholder="Nome do contato no cliente (opcional)"
                  value={form.contactName}
                  onChange={(e) =>
                    setForm({ ...form, contactName: e.target.value })
                  }
                />
              </Field.Control>
            </Field>

            <Field.Row cols={2}>
              <Field name="methodologyScore" required>
                <Field.Label>Metodologia</Field.Label>
                <Field.Control>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    inputMode="numeric"
                    value={form.methodologyScore}
                    onChange={(e) =>
                      setForm({ ...form, methodologyScore: e.target.value })
                    }
                  />
                </Field.Control>
                <Field.Hint>Processo, ritmo, clareza</Field.Hint>
              </Field>
              <Field name="teamScore" required>
                <Field.Label>Time</Field.Label>
                <Field.Control>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    inputMode="numeric"
                    value={form.teamScore}
                    onChange={(e) =>
                      setForm({ ...form, teamScore: e.target.value })
                    }
                  />
                </Field.Control>
                <Field.Hint>Skills, postura, entrega</Field.Hint>
              </Field>
            </Field.Row>

            <Field.Row cols={2}>
              <Field name="csatScore" required>
                <Field.Label>CSAT</Field.Label>
                <Field.Control>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    inputMode="numeric"
                    value={form.csatScore}
                    onChange={(e) =>
                      setForm({ ...form, csatScore: e.target.value })
                    }
                  />
                </Field.Control>
                <Field.Hint>Satisfação geral</Field.Hint>
              </Field>
              <Field name="npsScore" required>
                <Field.Label>NPS</Field.Label>
                <Field.Control>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    inputMode="numeric"
                    value={form.npsScore}
                    onChange={(e) =>
                      setForm({ ...form, npsScore: e.target.value })
                    }
                  />
                </Field.Control>
                <Field.Hint>Recomendaria a Volund?</Field.Hint>
              </Field>
            </Field.Row>

            <Field name="whatsGood">
              <Field.Label>O que está bom</Field.Label>
              <Field.Control>
                <Textarea
                  rows={3}
                  placeholder="O que tem funcionado bem"
                  value={form.whatsGood}
                  onChange={(e) =>
                    setForm({ ...form, whatsGood: e.target.value })
                  }
                />
              </Field.Control>
            </Field>

            <Field name="whatsToImprove">
              <Field.Label>O que melhorar</Field.Label>
              <Field.Control>
                <Textarea
                  rows={3}
                  placeholder="O que pode melhorar"
                  value={form.whatsToImprove}
                  onChange={(e) =>
                    setForm({ ...form, whatsToImprove: e.target.value })
                  }
                />
              </Field.Control>
            </Field>
          </FormBody>
        </ResponsiveSheetBody>

        <ResponsiveSheetFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? "Salvando…" : existing ? "Salvar" : "Registrar"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
