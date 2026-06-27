// Binding folder-do-Granola → projeto (runbook pm-review-granola-folder, Fase 1.2).
//
//   GET  → folders disponíveis (token do member logado) + bindings já criados
//   POST → cria binding { folderId, folderName? } (memberId = member logado)
//
// Autoridade: mesma do PM Review — Manager/PM ou acima (ou grant ritual.pm_review).
// Como as rotas usam service_role (bypassa RLS), a autorização vive no guard:
//   - GET  → requireProjectViewApi (quem vê o projeto lê os bindings)
//   - POST → pm_review.write (só Manager/PM ou acima escreve)

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentMember, requireProjectViewApi } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { getMemberGranolaClient } from "@/lib/member-integrations";
import { createAdminClient } from "@/lib/supabase/admin";

export interface GranolaFolderOption {
  id: string;
  name: string | null;
  parentFolderId: string | null;
}

export interface GranolaFolderBinding {
  id: string;
  folderId: string;
  folderName: string | null;
  /** Token que dirige o roteamento. Null = órfão (PM saiu) — re-vincular. */
  memberId: string | null;
  createdAt: string;
}

export interface GranolaFoldersResponse {
  needsAuth: boolean;
  available: GranolaFolderOption[];
  bindings: GranolaFolderBinding[];
  error?: string;
}

const postSchema = z.object({
  folderId: z.string().min(1).max(200),
  folderName: z.string().max(500).nullish(),
});

async function loadBindings(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<GranolaFolderBinding[]> {
  const { data } = await admin
    .from("ProjectGranolaFolder")
    .select("id, folderId, folderName, memberId, createdAt")
    .eq("projectId", projectId)
    .order("createdAt", { ascending: true });
  return (data ?? []) as GranolaFolderBinding[];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const denied = await requireProjectViewApi(projectId);
  if (denied) return denied;

  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 403 });
  }

  const admin = createAdminClient();
  const bindings = await loadBindings(admin, projectId);

  // Folders disponíveis vêm do token pessoal do PM logado. Sem token → needsAuth.
  const client = await getMemberGranolaClient(member.id);
  if (!client) {
    return NextResponse.json({
      needsAuth: true,
      available: [],
      bindings,
    } satisfies GranolaFoldersResponse);
  }

  try {
    const folders = await client.listAllFolders();
    const available: GranolaFolderOption[] = folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentFolderId: f.parent_folder_id ?? null,
    }));
    return NextResponse.json({
      needsAuth: false,
      available,
      bindings,
    } satisfies GranolaFoldersResponse);
  } catch (err) {
    const msg = (err as Error).message || "";
    return NextResponse.json({
      needsAuth: false,
      available: [],
      bindings,
      error:
        msg.includes("401") || msg.includes("403")
          ? "Token Granola inválido ou expirado — reconecte em Integrações."
          : msg.includes("404")
            ? "Este token Granola não tem acesso à API de folders (requer v1.1.0)."
            : `Falha ao listar folders do Granola: ${msg}`,
    } satisfies GranolaFoldersResponse);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  // PM Review = Manager (PM) ou acima (ou grant ritual.pm_review). authz-catalog.ts.
  const denied = await requireCapabilityApi("pm_review.write", { projectId });
  if (denied) return denied;

  const member = await getCurrentMember();
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 403 });
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ProjectGranolaFolder")
    .insert({
      projectId,
      folderId: parsed.data.folderId,
      folderName: parsed.data.folderName ?? null,
      memberId: member.id,
    })
    .select("id, folderId, folderName, memberId, createdAt")
    .single();

  if (error) {
    // 23505 = unique_violation (folder já vinculada a algum projeto).
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Esta folder já está vinculada a um projeto." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ binding: data as GranolaFolderBinding }, { status: 201 });
}
