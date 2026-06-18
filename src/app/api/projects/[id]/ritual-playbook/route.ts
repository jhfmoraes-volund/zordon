// Autoria do Ritual Playbook (design synth 2026-06-17).
//   GET ?ritualType=pm_review  → capabilities autoradas (ênfase/redact/…)
//   PUT { ritualType, capabilities, enabled? } → valida no registry + upsert
//
// Autoridade = mesma do PM Review (admin OU ProjectAccess.role='lead'). GET lê
// quem vê o projeto; PUT exige canCreatePMReviewForProject. db()=service_role
// (bypassa RLS) → autorização vive no guard.
//
// Nota: load_context(granola_folder) NÃO é autorado aqui — vem dos bindings de
// folder (ProjectGranolaFolder, via o card do Granola). getEffectivePlaybook
// mescla os dois. Esta rota cuida de ênfase/redact (+ futuras fontes drive/notion).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProjectViewApi } from "@/lib/dal";
import { canCreatePMReviewForProject } from "@/lib/pm-review/permission";
import { getCurrentMember } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { playbookCapabilitiesSchema } from "@/lib/rituals/capability-registry";
import type { RitualType } from "@/lib/rituals/types";
import type { Json } from "@/lib/supabase/database.types";

const RITUAL_TYPES: RitualType[] = ["pm_review", "planning", "release_planning"];

function parseRitualType(raw: string | null): RitualType {
  return RITUAL_TYPES.includes(raw as RitualType) ? (raw as RitualType) : "pm_review";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const denied = await requireProjectViewApi(projectId);
  if (denied) return denied;

  const ritualType = parseRitualType(req.nextUrl.searchParams.get("ritualType"));
  const admin = createAdminClient();
  const { data } = await admin
    .from("RitualPlaybook")
    .select("capabilities, enabled, updatedAt")
    .eq("projectId", projectId)
    .eq("ritualType", ritualType)
    .maybeSingle();

  // Fontes Drive disponíveis pro picker (arquivos já importados no pool).
  const { data: drive } = await admin
    .from("ContextSource")
    .select('id, title, "capturedAt"')
    .eq("projectId", projectId)
    .eq("kind", "gdrive_file")
    .order("capturedAt", { ascending: false, nullsFirst: false });

  return NextResponse.json({
    ritualType,
    capabilities: data?.capabilities ?? [],
    enabled: data?.enabled ?? true,
    updatedAt: data?.updatedAt ?? null,
    driveSources: (drive ?? []).map((d) => ({
      id: d.id as string,
      title: (d.title as string | null) ?? "(sem título)",
      capturedAt: (d.capturedAt as string | null) ?? null,
    })),
  });
}

const putSchema = z.object({
  ritualType: z.enum(["pm_review", "planning", "release_planning"]).optional(),
  capabilities: playbookCapabilitiesSchema,
  enabled: z.boolean().optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const denied = await requireProjectViewApi(projectId);
  if (denied) return denied;
  if (!(await canCreatePMReviewForProject(projectId))) {
    return NextResponse.json(
      { error: "Apenas PMs (lead) ou admins podem editar o playbook." },
      { status: 403 },
    );
  }

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const member = await getCurrentMember();
  const ritualType = parsed.data.ritualType ?? "pm_review";
  const admin = createAdminClient();

  const { error } = await admin.from("RitualPlaybook").upsert(
    {
      projectId,
      ritualType,
      // Validado pelo registry; JSON-serializável (params é z.unknown no schema).
      capabilities: parsed.data.capabilities as unknown as Json,
      enabled: parsed.data.enabled ?? true,
      authoredById: member?.id ?? null,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "projectId,ritualType" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
