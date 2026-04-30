"use client";

import { useMemo, useState } from "react";
import { Wand2, Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { roleLabel } from "@/lib/roles";
import {
  ROLE_BASE,
  SENIORITY_LABELS,
  SENIORITY_ORDER,
  computeSuggestedCapacity,
  type Seniority,
} from "@/lib/capacity";

type Props = {
  memberId: string;
  role: string;
  isExternal: boolean;
  initialCapacity: number;
  initialSeniority: Seniority | null;
  initialDedication: number;
  onSaved: (next: {
    fpCapacity: number;
    seniority: Seniority | null;
    dedicationPercent: number;
  }) => void;
};

export function CapacityWidget({
  memberId,
  role,
  isExternal,
  initialCapacity,
  initialSeniority,
  initialDedication,
  onSaved,
}: Props) {
  const [seniority, setSeniority] = useState<Seniority | null>(initialSeniority);
  const [dedication, setDedication] = useState<number>(initialDedication ?? 100);
  const [capacity, setCapacity] = useState<number>(initialCapacity);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const breakdown = useMemo(
    () =>
      computeSuggestedCapacity({
        role,
        seniority,
        dedicationPercent: dedication,
      }),
    [role, seniority, dedication],
  );

  const baseRole = ROLE_BASE[role as keyof typeof ROLE_BASE] ?? 0;
  const matchesSuggestion = capacity === breakdown.suggested;
  const dirty =
    capacity !== initialCapacity ||
    seniority !== initialSeniority ||
    dedication !== (initialDedication ?? 100);
  const nonExecutive = baseRole === 0;

  const applySuggestion = () => setCapacity(breakdown.suggested);

  const reset = () => {
    setSeniority(initialSeniority);
    setDedication(initialDedication ?? 100);
    setCapacity(initialCapacity);
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/members/${memberId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fpCapacity: capacity,
          seniority,
          dedicationPercent: dedication,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `Erro ${res.status}`);
      }
      onSaved({ fpCapacity: capacity, seniority, dedicationPercent: dedication });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="rounded-lg p-5 space-y-5"
      style={{
        background: "var(--card)",
        boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.08)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold leading-none mb-1.5">Cálculo de capacity</p>
          <p className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground/70">
            {roleLabel(role)} · {isExternal ? "externo" : "interno"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground/70 mb-1">
            sugerido
          </p>
          <p className="font-mono tabular-nums text-3xl font-bold leading-none" style={{ color: "oklch(0.82 0.2 22)" }}>
            {breakdown.suggested}
            <span className="text-sm text-muted-foreground/60 font-normal ml-1">FP</span>
          </p>
        </div>
      </div>

      {nonExecutive && (
        <p className="text-xs text-muted-foreground italic border border-dashed border-foreground/10 rounded-md px-3 py-2">
          Esse role é estratégico e não executa tasks técnicas. A capacity sugerida é 0.
        </p>
      )}

      {/* Senioridade */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Senioridade</span>
          <span className="font-mono tabular-nums text-[10px] tracking-[0.08em] uppercase text-muted-foreground">
            ×{breakdown.seniorityMult.toFixed(2)}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {SENIORITY_ORDER.map((s) => {
            const active = seniority === s || (seniority === null && s === "mid");
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSeniority(s)}
                className={`h-8 rounded-md text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {SENIORITY_LABELS[s]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Dedicação */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Dedicação</span>
          <span className="font-mono tabular-nums text-xs">{dedication}%</span>
        </div>
        <Slider
          value={[dedication]}
          onValueChange={(v) => {
            const next = Array.isArray(v) ? v[0] : v;
            if (typeof next === "number") setDedication(Math.round(next));
          }}
          min={0}
          max={100}
          step={5}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground/70 font-mono tabular-nums">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Breakdown */}
      <div
        className="rounded-md px-3 py-2 text-[11px] font-mono tabular-nums leading-relaxed bg-muted/50"
        style={{
          boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.05)",
        }}
      >
        <div className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground/70 mb-1">
          fórmula
        </div>
        <div>
          <span className="text-foreground">{breakdown.base}</span>
          <span className="text-muted-foreground"> base</span>
          <span className="text-muted-foreground/60 mx-1">×</span>
          <span className="text-foreground">{breakdown.seniorityMult.toFixed(2)}</span>
          <span className="text-muted-foreground/60 mx-1">×</span>
          <span className="text-foreground">{Math.round(breakdown.dedication * 100)}%</span>
          <span className="text-muted-foreground/60 mx-1">=</span>
          <span className="text-foreground font-medium">{breakdown.suggested}</span>
        </div>
      </div>

      {/* Capacity efetivo */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Capacity efetiva</span>
          {!matchesSuggestion && (
            <span className="text-[10px] tracking-[0.08em] uppercase font-mono text-amber-500">
              override manual
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            max={2000}
            value={capacity}
            onChange={(e) => setCapacity(Math.max(0, Number(e.target.value) || 0))}
            className="font-mono tabular-nums w-24"
          />
          <span className="text-xs text-muted-foreground">FP/sprint</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={applySuggestion}
            disabled={matchesSuggestion}
            className="ml-auto"
          >
            <Wand2 className="h-3.5 w-3.5 mr-1.5" />
            Usar sugestão
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {/* Footer */}
      <div className="flex justify-end gap-2 pt-1">
        {dirty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={saving}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Reverter
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={!dirty || saving}
        >
          <Save className="h-3.5 w-3.5 mr-1.5" />
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </div>
  );
}
