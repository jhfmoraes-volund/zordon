"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Save } from "lucide-react";
import { FieldInput, FieldLabel } from "./param-inputs";
import type { SettingsSchema } from "@/lib/agent/settings-schema";

type Values = Record<string, unknown>;

export function ParamForm({
  agentSlug,
  schema,
  initialValues,
}: {
  agentSlug: string;
  schema: SettingsSchema;
  initialValues: Values;
}) {
  const [pristine, setPristine] = useState<Values>(initialValues);
  const [values, setValues] = useState<Values>(initialValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSavedAt, setJustSavedAt] = useState<number | null>(null);

  const dirtyKeys = useMemo(
    () =>
      Object.keys(values).filter(
        (k) => JSON.stringify(values[k]) !== JSON.stringify(pristine[k]),
      ),
    [values, pristine],
  );

  const categories = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [k, f] of Object.entries(schema)) {
      const cat = f.category || "Geral";
      const bucket = map.get(cat) || [];
      bucket.push(k);
      map.set(cat, bucket);
    }
    return map;
  }, [schema]);

  const setField = (key: string, next: unknown) => {
    setValues((prev) => ({ ...prev, [key]: next }));
  };

  const saveAll = async () => {
    if (dirtyKeys.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      for (const key of dirtyKeys) {
        const res = await fetch(`/api/agents/${agentSlug}/configs/${key}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: values[key] }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(`${key}: ${data.error || res.statusText}`);
        }
      }
      setPristine(values);
      setJustSavedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setValues(pristine);
    setError(null);
  };

  return (
    <div className="space-y-6">
      {/* Sticky action bar */}
      <div className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-background/95 backdrop-blur border-b border-border flex items-center justify-between">
        <div className="text-sm">
          {dirtyKeys.length > 0 ? (
            <span className="text-amber-600">
              {dirtyKeys.length} alteração{dirtyKeys.length > 1 ? "ões" : ""} não salva{dirtyKeys.length > 1 ? "s" : ""}
            </span>
          ) : justSavedAt ? (
            <span className="text-green-600">Alterações salvas.</span>
          ) : (
            <span className="text-muted-foreground">Nenhuma alteração.</span>
          )}
          {error && <span className="text-red-600 ml-3">· {error}</span>}
        </div>
        <div className="flex items-center gap-2">
          {dirtyKeys.length > 0 && (
            <Button size="sm" variant="ghost" onClick={discard} disabled={saving}>
              Descartar
            </Button>
          )}
          <Button size="sm" onClick={saveAll} disabled={saving || dirtyKeys.length === 0}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salvar
          </Button>
        </div>
      </div>

      {/* Fields grouped by category */}
      {Array.from(categories.entries()).map(([category, keys]) => (
        <section key={category} className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {category}
          </h3>
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {keys.map((key) => {
                const field = schema[key];
                const dirty = JSON.stringify(values[key]) !== JSON.stringify(pristine[key]);
                return (
                  <div key={key} className="p-4 space-y-3">
                    <FieldLabel fieldKey={key} field={field} dirty={dirty} />
                    <FieldInput
                      fieldKey={key}
                      field={field}
                      value={values[key]}
                      onChange={(next) => setField(key, next)}
                      disabled={saving}
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>
      ))}
    </div>
  );
}
