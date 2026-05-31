"use client";

import { useState, useEffect } from "react";
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
import { StatusChipSelect } from "@/components/ui/status-chip-select";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import type { OpportunityRow } from "@/lib/dal/opportunities";
import type { ChipDescriptor } from "@/lib/status-chips";

// Opportunity status registry (matches opportunity-card.tsx)
const OPPORTUNITY_STATUS: Record<OpportunityRow["status"], ChipDescriptor> = {
  discovery: { label: "Descoberta", tone: "blue" },
  evaluating: { label: "Avaliando", tone: "amber" },
  approved: { label: "Aprovado", tone: "green" },
  in_project: { label: "Em projeto", tone: "purple" },
  rejected: { label: "Rejeitado", tone: "muted" },
};

type OpportunitySheetProps = {
  opportunity: OpportunityRow | null;
  onClose: () => void;
  /** Persist updates (patch). */
  onSave: (updated: Partial<OpportunityRow>) => void | Promise<void>;
  /** Promote to project (only shown for status=approved). */
  onPromote?: (opportunityId: string, projectName?: string) => void | Promise<void>;
};

export function OpportunitySheet({
  opportunity,
  onClose,
  onSave,
  onPromote,
}: OpportunitySheetProps) {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // Local drafts for form fields - initialize from opportunity
  const [title, setTitle] = useState(() => opportunity?.title ?? "");
  const [description, setDescription] = useState(() => opportunity?.description ?? "");
  const [impact, setImpact] = useState<number>(() => opportunity?.impact ?? 3);
  const [effort, setEffort] = useState<number>(() => opportunity?.effort ?? 3);
  const [status, setStatus] = useState<OpportunityRow["status"]>(() => opportunity?.status ?? "discovery");

  // Track the current opportunity ID to detect changes
  const [currentId, setCurrentId] = useState<string | null>(opportunity?.id ?? null);

  // Reset drafts when a different opportunity is opened
  if (opportunity?.id !== currentId) {
    setCurrentId(opportunity?.id ?? null);
    if (opportunity) {
      setTitle(opportunity.title);
      setDescription(opportunity.description ?? "");
      setImpact(opportunity.impact);
      setEffort(opportunity.effort);
      setStatus(opportunity.status);
    } else {
      setTitle("");
      setDescription("");
      setImpact(3);
      setEffort(3);
      setStatus("discovery");
    }
  }

  // Validation
  const titleValid = title.trim().length > 0;
  const impactValid = impact >= 1 && impact <= 5;
  const effortValid = effort >= 1 && effort <= 5;
  const canSave = titleValid && impactValid && effortValid;

  function handleSave() {
    if (!canSave || !opportunity) return;

    const patch: Partial<OpportunityRow> = {};
    if (title !== opportunity.title) patch.title = title;
    if (description !== (opportunity.description ?? "")) {
      patch.description = description.trim() === "" ? null : description;
    }
    if (impact !== opportunity.impact) patch.impact = impact;
    if (effort !== opportunity.effort) patch.effort = effort;
    if (status !== opportunity.status) patch.status = status;

    if (Object.keys(patch).length > 0) {
      onSave(patch);
    }
    onClose();
  }

  function handleDiscard() {
    onClose();
  }

  function handlePromote() {
    if (!opportunity || status !== "approved") return;
    setConfirm({
      title: "Promover para Projeto?",
      description: `Isso criará um novo projeto e abrirá uma Design Session de Inception vinculada à oportunidade "${title}".`,
      confirmLabel: "Promover",
      onConfirm: async () => {
        await onPromote?.(opportunity.id, title);
        onClose();
      },
    });
  }

  const open = opportunity !== null;
  const showPromoteButton = status === "approved" && onPromote;

  return (
    <>
      <ResponsiveSheet open={open} onOpenChange={(next) => !next && onClose()}>
        <ResponsiveSheetContent size="md" showCloseButton={false}>
          <ResponsiveSheetHeader>
            <ResponsiveSheetTitle>
              {opportunity?.id ? "Editar Oportunidade" : "Nova Oportunidade"}
            </ResponsiveSheetTitle>
          </ResponsiveSheetHeader>

          <ResponsiveSheetBody>
            <FormBody density="comfortable">
              <Field name="title" required error={!titleValid && title.length > 0 ? "Título obrigatório" : undefined}>
                <Field.Label>Título</Field.Label>
                <Field.Control>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex: Automatizar fluxo de aprovação de férias"
                  />
                </Field.Control>
              </Field>

              <Field name="description">
                <Field.Label>Descrição</Field.Label>
                <Field.Control>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Contexto, problema, valor esperado…"
                    rows={4}
                    className="min-h-24"
                  />
                </Field.Control>
              </Field>

              <Field.Row cols={2}>
                <Field name="impact" required error={!impactValid ? "Impacto entre 1 e 5" : undefined}>
                  <Field.Label>Impacto (1-5)</Field.Label>
                  <Field.Control>
                    <Select
                      value={String(impact)}
                      onValueChange={(v) => setImpact(Number(v))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field.Control>
                </Field>

                <Field name="effort" required error={!effortValid ? "Esforço entre 1 e 5" : undefined}>
                  <Field.Label>Esforço (1-5)</Field.Label>
                  <Field.Control>
                    <Select
                      value={String(effort)}
                      onValueChange={(v) => setEffort(Number(v))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5].map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field.Control>
                </Field>
              </Field.Row>

              <Field name="status" required>
                <Field.Label>Status</Field.Label>
                <Field.Control>
                  <StatusChipSelect
                    variant="input"
                    value={status}
                    options={OPPORTUNITY_STATUS}
                    onValueChange={(v) => setStatus(v as OpportunityRow["status"])}
                  />
                </Field.Control>
              </Field>

              {/* TODO: Phase 2 - sourceMeetingId, sourceDesignSessionId pickers */}
            </FormBody>
          </ResponsiveSheetBody>

          <ResponsiveSheetFooter>
            <Button variant="outline" onClick={handleDiscard}>
              Descartar
            </Button>
            {showPromoteButton && (
              <Button variant="default" onClick={handlePromote}>
                Promover → Projeto
              </Button>
            )}
            <Button variant="default" onClick={handleSave} disabled={!canSave}>
              Salvar
            </Button>
          </ResponsiveSheetFooter>
        </ResponsiveSheetContent>
      </ResponsiveSheet>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
