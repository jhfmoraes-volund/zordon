"use client";

import { useEffect, useState } from "react";
import { Target, Sparkles, AlertTriangle, Lightbulb, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetFooter,
  ResponsiveSheetDescription,
  ResponsiveSheetBody,
} from "@/components/ui/responsive-sheet";
import {
  SPRINT_GOAL_MAX_LENGTH,
  type Sprint,
  type SprintRetrospective,
} from "@/components/sprint/types";
import { fetchOrThrow } from "@/lib/optimistic/toast";
import { showErrorToast } from "@/lib/optimistic/toast";
import { toast } from "sonner";

export type SprintContextSheetMode = "view" | "edit-goal" | "complete";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sprint: Sprint | null;
  mode: SprintContextSheetMode;
  /** Notify parent so it can reload sprint list / retro state. */
  onSaved?: () => void | Promise<void>;
};

function rangeLabel(sprint: Sprint) {
  const start = new Date(`${sprint.startDate}T00:00:00`);
  const end = new Date(`${sprint.endDate}T00:00:00`);
  const fmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
  return `${fmt.format(start)} → ${fmt.format(end)}`;
}

export function SprintContextSheet({
  open,
  onOpenChange,
  sprint,
  mode,
  onSaved,
}: Props) {
  const [goalDraft, setGoalDraft] = useState("");
  const [good, setGood] = useState("");
  const [bad, setBad] = useState("");
  const [ideas, setIdeas] = useState("");
  const [retro, setRetro] = useState<SprintRetrospective | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const readOnly = mode === "view";
  const showRetroSection = mode === "complete" || mode === "view";

  // Reset/load on open
  useEffect(() => {
    if (!open || !sprint) return;
    setGoalDraft(sprint.goal ?? "");

    if (!showRetroSection) {
      setRetro(null);
      setGood("");
      setBad("");
      setIdeas("");
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetch(`/api/sprints/${sprint.id}/retrospective`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SprintRetrospective | null) => {
        if (cancelled) return;
        setRetro(data);
        setGood(data?.goodPoints ?? "");
        setBad(data?.badPoints ?? "");
        setIdeas(data?.ideas ?? "");
      })
      .catch(() => {
        if (cancelled) return;
        setRetro(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sprint, showRetroSection]);

  if (!sprint) return null;

  const goalChanged = (sprint.goal ?? "") !== goalDraft.trim();
  const goalTooLong = goalDraft.length > SPRINT_GOAL_MAX_LENGTH;

  async function handleSaveGoal() {
    if (!sprint || saving || goalTooLong) return;
    setSaving(true);
    try {
      const trimmed = goalDraft.trim();
      await fetchOrThrow(`/api/sprints/${sprint.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: trimmed === "" ? null : trimmed }),
      });
      toast.success("Objetivo salvo");
      await onSaved?.();
      onOpenChange(false);
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar objetivo" });
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRetroOnly() {
    if (!sprint || saving) return;
    setSaving(true);
    try {
      await fetchOrThrow(`/api/sprints/${sprint.id}/retrospective`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goodPoints: good,
          badPoints: bad,
          ideas: ideas,
        }),
      });
      toast.success("Retrospectiva atualizada");
      await onSaved?.();
      onOpenChange(false);
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar retrospectiva" });
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete() {
    if (!sprint || saving) return;
    setSaving(true);
    try {
      await fetchOrThrow(`/api/sprints/${sprint.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goodPoints: good,
          badPoints: bad,
          ideas: ideas,
        }),
      });
      toast.success("Sprint concluída");
      await onSaved?.();
      onOpenChange(false);
    } catch (e) {
      showErrorToast(e, { label: "Falha ao concluir sprint" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle className="flex items-center gap-2 text-base">
            <Target className="size-4 text-primary" />
            {sprint.name}
          </ResponsiveSheetTitle>
          <ResponsiveSheetDescription className="font-mono text-xs tabular-nums">
            {rangeLabel(sprint)} · {labelForStatus(sprint.status)}
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody className="space-y-6">
          {/* Goal */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label className="text-sm font-semibold">Objetivo do sprint</Label>
              {!readOnly && (
                <span
                  className={`text-xs tabular-nums ${
                    goalTooLong ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {goalDraft.length}/{SPRINT_GOAL_MAX_LENGTH}
                </span>
              )}
            </div>
            {readOnly ? (
              sprint.goal ? (
                <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm leading-relaxed">
                  {sprint.goal}
                </p>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  Sem objetivo definido.
                </p>
              )
            ) : (
              <>
                <Textarea
                  value={goalDraft}
                  onChange={(e) =>
                    setGoalDraft(e.target.value.slice(0, SPRINT_GOAL_MAX_LENGTH))
                  }
                  placeholder="Manifesto da iteração — o que precisa ser entregue pra esse sprint ter valido a pena?"
                  rows={3}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Sprint Goal alinha o time num resultado de negócio. Serve de critério
                  de corte quando o sprint estoura capacidade.
                </p>
              </>
            )}
          </section>

          {/* Retro */}
          {showRetroSection && (
            <section className="space-y-4 border-t pt-5">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">Retrospectiva</h3>
                <p className="text-xs text-muted-foreground">
                  {mode === "complete"
                    ? "Reflita antes de fechar o sprint. Todos os campos são opcionais."
                    : retro
                    ? `Registrada em ${new Date(retro.completedAt).toLocaleDateString("pt-BR")}.`
                    : "Sem retrospectiva registrada."}
                </p>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-6 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                </div>
              ) : (
                <>
                  <RetroField
                    icon={Sparkles}
                    iconClass="text-emerald-500"
                    label="Quebom"
                    placeholder="O que funcionou bem? O que devemos manter?"
                    value={good}
                    onChange={setGood}
                    readOnly={readOnly}
                  />
                  <RetroField
                    icon={AlertTriangle}
                    iconClass="text-amber-500"
                    label="Quepena"
                    placeholder="O que não funcionou? Onde travamos?"
                    value={bad}
                    onChange={setBad}
                    readOnly={readOnly}
                  />
                  <RetroField
                    icon={Lightbulb}
                    iconClass="text-sky-500"
                    label="Quetal"
                    placeholder="O que vamos experimentar no próximo sprint?"
                    value={ideas}
                    onChange={setIdeas}
                    readOnly={readOnly}
                  />
                </>
              )}
            </section>
          )}
        </ResponsiveSheetBody>

        <ResponsiveSheetFooter>
          {mode === "view" ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          ) : mode === "edit-goal" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancelar
              </Button>
              {sprint.status === "completed" ? (
                <Button onClick={handleSaveRetroOnly} disabled={saving}>
                  {saving ? "Salvando..." : "Salvar retro"}
                </Button>
              ) : null}
              <Button
                onClick={handleSaveGoal}
                disabled={saving || goalTooLong || !goalChanged}
              >
                {saving ? "Salvando..." : "Salvar objetivo"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button onClick={handleComplete} disabled={saving}>
                {saving ? "Concluindo..." : "Concluir sprint"}
              </Button>
            </>
          )}
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}

function RetroField({
  icon: Icon,
  iconClass,
  label,
  placeholder,
  value,
  onChange,
  readOnly,
}: {
  icon: typeof Sparkles;
  iconClass: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-sm">
        <Icon className={`size-4 ${iconClass}`} />
        {label}
      </Label>
      {readOnly ? (
        value ? (
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
            {value}
          </p>
        ) : (
          <p className="text-xs italic text-muted-foreground">—</p>
        )
      ) : (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="resize-none"
        />
      )}
    </div>
  );
}

function labelForStatus(status: Sprint["status"]): string {
  switch (status) {
    case "active":
      return "Ativa";
    case "upcoming":
      return "A iniciar";
    case "completed":
      return "Concluída";
  }
}
