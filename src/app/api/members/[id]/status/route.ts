import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser, getCurrentMember, requireRole, ForbiddenError } from "@/lib/dal";
import { ADMIN_ROLE_NAMES } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const DEACTIVATION_REASONS = ["terminated", "left", "other"] as const;

// Ban "perpétuo" (~100 anos). Supabase aceita uma string de duração; "none" desbane.
const PERMANENT_BAN = "876600h";

/**
 * PATCH /api/members/[id]/status — admin-only.
 *
 * Desativar (soft-delete) ≠ excluir. A row do Member permanece — preserva 100% do
 * histórico de participação (autoria de tasks/comentários/sessions, alocações
 * passadas). O membro perde login, sai de rosters / capacidade / headcount.
 * Totalmente reversível (reativar).
 *
 * Body: { active: boolean; reason?: 'terminated' | 'left' | 'other' }
 *   - active:false → desativa. `reason` obrigatório. BLOQUEIA (409) se o membro
 *     for PM (Project.pmId) de algum projeto — reatribua o PM antes.
 *   - active:true  → reativa.
 *
 * Login: bane/desbane o auth user (ban_duration). Ressalva conhecida: o JWT
 * vigente segue válido até expirar (~1h), igual ao DELETE.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  try {
    await requireRole(ADMIN_ROLE_NAMES);
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse(e.message, { status: 403 });
    throw e;
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const active = body?.active;
  if (typeof active !== "boolean") {
    return NextResponse.json(
      { error: "body.active (boolean) é obrigatório" },
      { status: 400 },
    );
  }

  const supabase = db();
  const { data: existing } = await supabase
    .from("Member")
    .select("id, name, userId, deactivatedAt")
    .eq("id", id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // ── Reativar ──────────────────────────────────────────────────────────────
  if (active) {
    const { data: member, error } = await supabase
      .from("Member")
      .update({ deactivatedAt: null, deactivatedReason: null, deactivatedById: null })
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (existing.userId) {
      const admin = createAdminClient();
      const { error: authErr } = await admin.auth.admin.updateUserById(existing.userId, {
        ban_duration: "none",
      });
      if (authErr) console.error("[members status] unban failed:", authErr.message);
    }
    return NextResponse.json(member);
  }

  // ── Desativar ─────────────────────────────────────────────────────────────
  const reason = body?.reason;
  if (
    typeof reason !== "string" ||
    !(DEACTIVATION_REASONS as readonly string[]).includes(reason)
  ) {
    return NextResponse.json(
      { error: `reason deve ser um de: ${DEACTIVATION_REASONS.join(", ")}` },
      { status: 400 },
    );
  }

  // Guard PM: não desativa quem ainda é gestor de projeto — reatribua antes.
  const { data: pmProjects } = await supabase
    .from("Project")
    .select("id, name")
    .eq("pmId", id);
  if (pmProjects && pmProjects.length > 0) {
    return NextResponse.json(
      {
        error: "Membro é PM de projeto(s). Reatribua o PM antes de desativar.",
        pmProjects,
      },
      { status: 409 },
    );
  }

  const actor = await getCurrentMember();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // D7: Desativar fecha TODAS as alocações abertas (voided_at IS NULL AND
  // effective_to IS NULL) do membro, em transação — preserva o período até hoje,
  // para de custear daqui pra frente. Reativar NÃO reabre — re-alocação é explícita.
  const financeClient = (await createClient() as unknown as SupabaseClient).schema("finance");
  // Lê as alocações abertas antes de fechar (pra emitir no evento)
  const { data: openAllocations } = await financeClient
    .from("labor_allocation")
    .select("id")
    .eq("member_id", id)
    .is("voided_at", null)
    .is("effective_to", null);
  const closedAllocationIds = (openAllocations ?? []).map((a: { id: string }) => a.id);
  const { error: allocError } = await financeClient
    .from("labor_allocation")
    .update({
      effective_to: today,
      closed_by: actor?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("member_id", id)
    .is("voided_at", null)
    .is("effective_to", null);
  if (allocError)
    return NextResponse.json(
      { error: `Erro ao fechar alocações: ${allocError.message}` },
      { status: 500 },
    );

  const { data: member, error } = await supabase
    .from("Member")
    .update({
      deactivatedAt: new Date().toISOString(),
      deactivatedReason: reason,
      deactivatedById: actor?.id ?? null,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (existing.userId) {
    const admin = createAdminClient();
    const { error: authErr } = await admin.auth.admin.updateUserById(existing.userId, {
      ban_duration: PERMANENT_BAN,
    });
    if (authErr) console.error("[members status] ban failed:", authErr.message);
  }

  // MAH-008: Emitir evento de desativação (com lista de alocações fechadas)
  const { recordMemberDeactivated } = await import("@/lib/dal/member-movement-recorder");
  void recordMemberDeactivated(id, reason, closedAllocationIds);

  return NextResponse.json(member);
}
