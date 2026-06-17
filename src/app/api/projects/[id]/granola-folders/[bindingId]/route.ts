// Remove um binding folder→projeto (runbook pm-review-granola-folder, Fase 1.2).
//   DELETE /api/projects/[id]/granola-folders/[bindingId]

import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi } from "@/lib/dal";
import { canCreatePMReviewForProject } from "@/lib/pm-review/permission";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; bindingId: string }> },
) {
  const { id: projectId, bindingId } = await params;
  const denied = await requireProjectViewApi(projectId);
  if (denied) return denied;
  if (!(await canCreatePMReviewForProject(projectId))) {
    return NextResponse.json(
      { error: "Apenas PMs (lead) ou admins podem desvincular folders." },
      { status: 403 },
    );
  }

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
