"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ParamForm } from "@/components/agent-settings/param-form";
import { AGENT_SETTINGS_REGISTRY } from "@/lib/agent/settings-registry";

export default function AgentSettingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [configs, setConfigs] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/agents/${slug}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Falha ao carregar");
        setConfigs(data.configs || {});
      })
      .catch((e: Error) => setError(e.message));
  }, [slug]);

  if (!slug) return null;

  const schema = AGENT_SETTINGS_REGISTRY[slug];
  if (!schema) {
    return (
      <div className="rounded-md border border-dashed border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Este agente ainda não tem parâmetros tunáveis registrados.
        </p>
        <p className="text-xs text-muted-foreground/70 mt-2">
          Adicione um schema em <code className="font-mono">src/lib/agent/agents/&lt;agent&gt;/settings.ts</code> e registre em <code className="font-mono">settings-registry.ts</code>.
        </p>
      </div>
    );
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!configs) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  // Fill missing keys with sensible empties so inputs render.
  const filled: Record<string, unknown> = {};
  for (const [k, field] of Object.entries(schema)) {
    if (configs[k] !== undefined) {
      filled[k] = configs[k];
    } else {
      filled[k] = defaultFor(field);
    }
  }

  return <ParamForm agentSlug={slug} schema={schema} initialValues={filled} />;
}

function defaultFor(field: { type: string; rows?: readonly string[]; cols?: readonly string[]; options?: unknown }): unknown {
  switch (field.type) {
    case "number": return 0;
    case "enum": {
      const opts = field.options as Array<{ value: string }> | undefined;
      return opts?.[0]?.value ?? "";
    }
    case "string_array": return [];
    case "matrix": {
      const m: Record<string, Record<string, number>> = {};
      for (const r of field.rows || []) {
        m[r] = {};
        for (const c of field.cols || []) m[r][c] = 0;
      }
      return m;
    }
    default: return null;
  }
}
