// Remove um binding folder→projeto (runbook pm-review-granola-folder, Fase 1.2).
//   DELETE /api/projects/[id]/granola-folders/[bindingId]

import { NextRequest, NextResponse } from "next/server";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; bindingId: string }> },
) {
  const { id: projectId, bindingId } = await params;
  // PM Review = Manager (PM) ou acima (ou grant ritual.pm_review). authz-catalog.ts.
  const denied = await requireCapabilityApi("pm_review.write", { projectId });
  if (denied) return denied;

  const admin = createAdminClient();

  // Escopado ao projeto da rota — não dá pra apagar binding de outro projeto.
  const { error } = await admin
    .from("ProjectGranolaFolder")
    .delete()
    .eq("id", bindingId)
    .eq("projectId", projectId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
