"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  STEP_CATALOG,
  ALWAYS_FIRST,
  ALWAYS_LAST,
  SUPER_OPTIONAL_STEPS,
} from "@/lib/design-session-steps";
import { ChevronUp, ChevronDown, Loader2 } from "lucide-react";

type Preset = "completa" | "enxuta" | "branco";

const PRESETS: Record<Preset, { label: string; description: string; keys: string[] }> = {
  completa: {
    label: "Completa",
    description: "Todos os 8 steps opcionais (equivale a uma Inception)",
    keys: [...SUPER_OPTIONAL_STEPS],
  },
  enxuta: {
    label: "Enxuta",
    description: "Sem visao de produto, personas e riscos — discovery direto",
    keys: SUPER_OPTIONAL_STEPS.filter(
      (k) => !["product_vision", "personas_journeys", "risks_gaps"].includes(k),
    ),
  },
  branco: {
    label: "Em branco",
    description: "So pre_work + briefing — adicione os steps que precisar",
    keys: [],
  },
};

export function SuperSessionModal({
  projectId,
  projectName,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [title, setTitle] = useState(`Super Session ${projectName}`);
  const [selected, setSelected] = useState<string[]>(PRESETS.completa.keys);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (preset: Preset) => {
    setSelected(PRESETS[preset].keys);
  };

  const toggle = (key: string) => {
    setSelected((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    );
  };

  const move = (key: string, direction: -1 | 1) => {
    setSelected((cur) => {
      const idx = cur.indexOf(key);
      if (idx === -1) return cur;
      const target = idx + direction;
      if (target < 0 || target >= cur.length) return cur;
      const next = [...cur];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const finalSteps = useMemo(
    () => [ALWAYS_FIRST, ...selected.filter((k) => k !== ALWAYS_FIRST && k !== ALWAYS_LAST), ALWAYS_LAST],
    [selected],
  );

  const submit = async () => {
    if (!title.trim()) {
      setError("Titulo obrigatorio");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/design-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          type: "super",
          title: title.trim(),
          selectedSteps: finalSteps,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Falha ao criar sessao");
        return;
      }
      onOpenChange(false);
      onCreated?.();
      router.push(`/design-sessions/${json.id}/steps/0`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile
            ? "max-h-[90vh] rounded-t-xl"
            : "w-full sm:max-w-xl",
        )}
      >
        {isMobile && (
          <div
            aria-hidden="true"
            className="mx-auto mt-2 mb-1 h-1.5 w-12 shrink-0 rounded-full bg-muted"
          />
        )}

        <div className="shrink-0 border-b px-4 py-4 sm:px-6 sm:py-5">
          <SheetTitle>Nova Super Session</SheetTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Escolha quais steps a sessao vai ter e em que ordem. Vitor enxergara apenas estes.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-5">
          <div className="grid gap-2">
            <Label htmlFor="super-title">Titulo</Label>
            <Input
              id="super-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Discovery rapido — modulo X"
            />
          </div>

          <div className="grid gap-2">
            <Label>Presets</Label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PRESETS) as Preset[]).map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => applyPreset(p)}
                  title={PRESETS[p].description}
                >
                  {PRESETS[p].label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Steps</Label>
            <div className="space-y-1">
              <StepRow
                stepKey={ALWAYS_FIRST}
                title={STEP_CATALOG[ALWAYS_FIRST].title}
                description={STEP_CATALOG[ALWAYS_FIRST].description}
                checked
                disabled
                mandatory
              />
              {selected.length > 0 && (
                <div className="space-y-1 pl-2 border-l-2 border-muted">
                  {selected.map((key, idx) => (
                    <StepRow
                      key={key}
                      stepKey={key}
                      title={STEP_CATALOG[key]?.title || key}
                      description={STEP_CATALOG[key]?.description || ""}
                      checked
                      onToggle={() => toggle(key)}
                      onMoveUp={idx > 0 ? () => move(key, -1) : undefined}
                      onMoveDown={idx < selected.length - 1 ? () => move(key, 1) : undefined}
                    />
                  ))}
                </div>
              )}
              <div className="pt-2">
                <p className="text-xs text-muted-foreground mb-1">Steps opcionais nao selecionados</p>
                {SUPER_OPTIONAL_STEPS.filter((k) => !selected.includes(k)).map((key) => (
                  <StepRow
                    key={key}
                    stepKey={key}
                    title={STEP_CATALOG[key].title}
                    description={STEP_CATALOG[key].description}
                    checked={false}
                    onToggle={() => toggle(key)}
                  />
                ))}
              </div>
              <StepRow
                stepKey={ALWAYS_LAST}
                title={STEP_CATALOG[ALWAYS_LAST].title}
                description={STEP_CATALOG[ALWAYS_LAST].description}
                checked
                disabled
                mandatory
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Ordem final: {finalSteps.length} steps.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="shrink-0 flex flex-col-reverse gap-2 border-t bg-popover px-4 py-3 sm:px-6 sm:flex-row sm:justify-end pb-safe">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={submitting || !title.trim()}>
            {submitting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            Criar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StepRow({
  stepKey,
  title,
  description,
  checked,
  disabled,
  mandatory,
  onToggle,
  onMoveUp,
  onMoveDown,
}: {
  stepKey: string;
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  mandatory?: boolean;
  onToggle?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  return (
    <div
      className={`flex items-start gap-2 p-2 rounded-md ${
        checked ? "bg-muted/50" : "hover:bg-muted/30"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle?.()}
        className="mt-1 h-4 w-4 rounded border-input accent-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{title}</span>
          <code className="text-xs text-muted-foreground">{stepKey}</code>
          {mandatory && (
            <Badge variant="secondary" className="text-xs">
              obrigatorio
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {(onMoveUp || onMoveDown) && (
        <div className="flex flex-col gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onMoveUp}
            disabled={!onMoveUp}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onMoveDown}
            disabled={!onMoveDown}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
