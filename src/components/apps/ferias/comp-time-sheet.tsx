"use client";

/**
 * Registrar hora extra — credita no banco de horas (folga). Crédito = horas ×
 * rate (default 1.5), mostrado ao vivo. RLS confina ao squad do PM.
 */

import { useState } from "react";

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
import { DatePicker } from "@/components/ui/date-picker";
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
import type { FeriasMember } from "@/lib/ferias/types";

export function CompTimeSheet({
  open,
  onOpenChange,
  members,
  presetMemberId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: FeriasMember[];
  presetMemberId?: string | null;
  onSaved: () => void;
}) {
  const [memberId, setMemberId] = useState(presetMemberId ?? "");
  const [date, setDate] = useState("");
  const [hoursWorked, setHoursWorked] = useState("");
  const [rate, setRate] = useState("1.5");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const hoursNum = parseFloat(hoursWorked.replace(",", "."));
  const rateNum = parseFloat(rate.replace(",", "."));
  const hoursValid = Number.isFinite(hoursNum) && hoursNum > 0;
  const rateValid = Number.isFinite(rateNum) && rateNum > 0;
  const credit = hoursValid && rateValid ? hoursNum * rateNum : 0;
  const canSave = !!memberId && !!date && hoursValid && rateValid && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await fetchOrThrow("/api/ferias/comp-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId,
          date,
          hoursWorked: hoursNum,
          rate: rateNum,
          note: note.trim() || null,
        }),
      });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      showErrorToast(e, { label: "Falha ao registrar hora extra" });
    } finally {
      setSaving(false);
    }
  }

  const memberName = members.find((m) => m.id === memberId)?.name;

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="sm">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Registrar hora extra</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          <FormBody density="comfortable">
            <Field.Row cols={2}>
              <Field name="member" required>
                <Field.Label>Membro</Field.Label>
                <Field.Control>
                  <Select value={memberId} onValueChange={(v) => setMemberId(v ?? "")}>
                    <SelectTrigger>
                      <SelectValue>
                        {() => memberName ?? "Selecione…"}
                      </SelectValue>
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
              <Field name="date" required>
                <Field.Label>Data</Field.Label>
                <Field.Control>
                  <DatePicker
                    data-slot="button"
                    value={date}
                    onChange={(iso) => setDate(iso)}
                  />
                </Field.Control>
              </Field>
            </Field.Row>

            <Field.Row cols={2}>
              <Field
                name="hours"
                required
                error={hoursWorked !== "" && !hoursValid ? "Inválido" : undefined}
              >
                <Field.Label>Horas extras</Field.Label>
                <Field.Control>
                  <Input
                    type="number"
                    min="0"
                    step="0.5"
                    inputMode="decimal"
                    value={hoursWorked}
                    onChange={(e) => setHoursWorked(e.target.value)}
                    placeholder="ex: 3"
                  />
                </Field.Control>
              </Field>
              <Field name="rate" required>
                <Field.Label>Fator</Field.Label>
                <Field.Control>
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    inputMode="decimal"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                  />
                </Field.Control>
                <Field.Hint>padrão 1.5×</Field.Hint>
              </Field>
            </Field.Row>

            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              Crédito no banco:{" "}
              <span className="font-mono font-medium tabular-nums">
                {credit.toFixed(1)} h
              </span>
            </div>

            <Field name="note">
              <Field.Label>Nota</Field.Label>
              <Field.Control>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ex: virada de release…"
                  className="min-h-16"
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
            {saving ? "Salvando…" : "Registrar"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
