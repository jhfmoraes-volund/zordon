import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireMinLevelApi } from "@/lib/dal";
import { ADMIN } from "@/lib/roles";
import { invalidateAgentConfigCache } from "@/lib/agent/config";
import { getSettingsSchema } from "@/lib/agent/settings-registry";
import type { SettingField } from "@/lib/agent/settings-schema";

/**
 * PATCH /api/agents/[slug]/configs/[key] — atualiza (ou cria) um valor de config.
 * Valida o shape do value contra o SettingField registrado no schema.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; key: string }> },
) {
  const denied = await requireMinLevelApi(ADMIN);
  if (denied) return denied;

  const { slug, key } = await params;
  const schema = getSettingsSchema(slug);
  if (!schema) return NextResponse.json({ error: "Agent sem settings" }, { status: 404 });

  const field = schema[key];
  if (!field) return NextResponse.json({ error: `Key "${key}" não existe no schema` }, { status: 400 });

  const body = await req.json();
  const value = body?.value;

  const validation = validateFieldValue(field, value);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  const supabase = db();
  const { data: agent } = await supabase
    .from("Agent")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const { error } = await supabase
    .from("AgentConfig")
    .upsert(
      {
        agentId: agent.id,
        key,
        value,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: "agentId,key" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  invalidateAgentConfigCache(agent.id);

  return NextResponse.json({ ok: true, key, value });
}

function validateFieldValue(
  field: SettingField,
  value: unknown,
): { ok: true } | { ok: false; error: string } {
  switch (field.type) {
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return { ok: false, error: "Value deve ser number" };
      }
      if (field.min !== undefined && value < field.min) {
        return { ok: false, error: `Valor mínimo ${field.min}` };
      }
      if (field.max !== undefined && value > field.max) {
        return { ok: false, error: `Valor máximo ${field.max}` };
      }
      return { ok: true };
    }
    case "enum": {
      if (typeof value !== "string") return { ok: false, error: "Value deve ser string" };
      if (!field.options.some((o) => o.value === value)) {
        return { ok: false, error: "Valor fora da lista de opções" };
      }
      return { ok: true };
    }
    case "string_array": {
      if (!Array.isArray(value)) return { ok: false, error: "Value deve ser array" };
      if (!value.every((v) => typeof v === "string")) {
        return { ok: false, error: "Todos os itens devem ser strings" };
      }
      if (field.options) {
        const allowed = new Set(field.options);
        const invalid = (value as string[]).find((v) => !allowed.has(v));
        if (invalid) return { ok: false, error: `Item fora das opções: ${invalid}` };
      }
      return { ok: true };
    }
    case "matrix": {
      if (!value || typeof value !== "object") {
        return { ok: false, error: "Value deve ser objeto" };
      }
      const obj = value as Record<string, unknown>;
      for (const row of field.rows) {
        const cell = obj[row];
        if (!cell || typeof cell !== "object") {
          return { ok: false, error: `Linha "${row}" inválida` };
        }
        for (const col of field.cols) {
          const n = (cell as Record<string, unknown>)[col];
          if (typeof n !== "number" || Number.isNaN(n)) {
            return { ok: false, error: `Célula [${row}][${col}] deve ser number` };
          }
          if (field.min !== undefined && n < field.min) {
            return { ok: false, error: `[${row}][${col}] abaixo de ${field.min}` };
          }
          if (field.max !== undefined && n > field.max) {
            return { ok: false, error: `[${row}][${col}] acima de ${field.max}` };
          }
        }
      }
      return { ok: true };
    }
  }
}
