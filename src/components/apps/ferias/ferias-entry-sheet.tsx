"use client";

/**
 * Lançar / editar férias ou folga — ResponsiveSheet + Field. Folga pede horas
 * (debita do banco). Membro não muda na edição. Escopo de squad é gateado pela
 * RLS na API (PM fora do squad → 403).
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
import type { FeriasMember, TimeOff, TimeOffType } from "@/lib/ferias/types";

const TYPE_LABEL: Record<TimeOffType, string> = {
  ferias: "Férias",
  folga: "Folga",
};

export function FeriasEntrySheet({
  open,
  onOpenChange,
  members,
  entry,
  presetMemberId,
  presetDate,
  onSaved,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: FeriasMember[];
  entry?: TimeOff | null;
  presetMemberId?: string | null;
  presetDate?: string | null;
  onSaved: () => void;
  onDelete?: (entry: TimeOff) => void;
}) {
  const editing = !!entry;
  const [memberId, setMemberId] = useState(
    entry?.memberId ?? presetMemberId ?? "",
  );
  const [type, setType] = useState<TimeOffType>(entry?.type ?? "ferias");
  const [startDate, setStartDate] = useState(
    entry?.startDate ?? presetDate ?? "",
  );
  const [endDate, setEndDate] = useState(
    entry?.endDate ?? presetDate ?? "",
  );
  const [hours, setHours] = useState(
    entry?.hours != null ? String(entry.hours) : "",
  );
  const [note, setNote] = useState(entry?.note ?? "");
  const [saving, setSaving] = useState(false);

  const hoursNum = parseFloat(hours.replace(",", "."));
  const hoursValid = type !== "folga" || (Number.isFinite(hoursNum) && hoursNum > 0);
  const datesValid = !!startDate && !!endDate && endDate >= startDate;
  const canSave = !!memberId && datesValid && hoursValid && !saving;

  async function handleSave() {
    if (!canSave) return;
    const payload = {
      memberId,
      type,
      startDate,
      endDate,
      hours: type === "folga" ? hoursNum : null,
      note: note.trim() || null,
    };
    setSaving(true);
    try {
      await fetchOrThrow(
        entry ? `/api/ferias/time-off/${entry.id}` : "/api/ferias/time-off",
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
        label: editing ? "Falha ao salvar" : "Falha ao lançar",
      });
    } finally {
      setSaving(false);
    }
  }

  const memberName = members.find((m) => m.id === memberId)?.name;

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="sm">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>
            {editing ? "Editar lançamento" : "Lançar ausência"}
          </ResponsiveSheetTitle>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          <FormBody density="comfortable">
            <Field.Row cols={2}>
              <Field name="member" required>
                <Field.Label>Membro</Field.Label>
                <Field.Control>
                  <Select
                    value={memberId}
                    onValueChange={(v) => setMemberId(v ?? "")}
                    disabled={editing}
                  >
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

              <Field name="type" required>
                <Field.Label>Tipo</Field.Label>
                <Field.Control>
                  <Select
                    value={type}
                    onValueChange={(v) => v && setType(v as TimeOffType)}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(v: string | null) =>
                          v ? TYPE_LABEL[v as TimeOffType] : ""
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(["ferias", "folga"] as TimeOffType[]).map((t) => (
                        <SelectItem key={t} value={t}>
                          {TYPE_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field.Control>
              </Field>
            </Field.Row>

            <Field.Row cols={2}>
              <Field name="start" required>
                <Field.Label>Início</Field.Label>
                <Field.Control>
                  <DatePicker
                    data-slot="button"
                    value={startDate}
                    onChange={(iso) => {
                      setStartDate(iso);
                      if (!endDate || endDate < iso) setEndDate(iso);
                    }}
                  />
                </Field.Control>
              </Field>
              <Field
                name="end"
                required
                error={
                  startDate && endDate && endDate < startDate
                    ? "Fim antes do início"
                    : undefined
                }
              >
                <Field.Label>Fim</Field.Label>
                <Field.Control>
                  <DatePicker
                    data-slot="button"
                    value={endDate}
                    onChange={(iso) => setEndDate(iso)}
                  />
                </Field.Control>
              </Field>
            </Field.Row>

            {type === "folga" && (
              <Field
                name="hours"
                required
                error={hours !== "" && !hoursValid ? "Horas inválidas" : undefined}
              >
                <Field.Label>Horas (debita do banco)</Field.Label>
                <Field.Control>
                  <Input
                    type="number"
                    min="0"
                    step="0.5"
                    inputMode="decimal"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                    placeholder="ex: 8"
                  />
                </Field.Control>
                <Field.Hint>folga consome horas do banco do membro</Field.Hint>
              </Field>
            )}

            <Field name="note">
              <Field.Label>Nota</Field.Label>
              <Field.Control>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Observações…"
                  className="min-h-16"
                />
              </Field.Control>
            </Field>
          </FormBody>
        </ResponsiveSheetBody>

        <ResponsiveSheetFooter>
          {entry && onDelete && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive hover:text-destructive"
              onClick={() => onDelete(entry)}
              disabled={saving}
            >
              Remover
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? "Salvando…" : editing ? "Salvar" : "Lançar"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
