/**
 * Design System do projeto (ContextSource singular kind='design_system').
 *   GET    → metadados do doc atual (+ URL assinada pra download) ou null
 *   PUT     (multipart `file`) → substitui/cria o doc; lido pelos agentes
 *   DELETE → remove o doc (row + arquivo do bucket)
 *
 * GET = quem vê o projeto. PUT/DELETE = manager+ (espelha a settings de DoD).
 * db()=service_role → autorização vive nos guards.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProjectViewApi, getActorMemberId } from "@/lib/dal";
import { requireCapabilityApi } from "@/lib/access/require-capability";
import { isOverSizeLimit } from "@/lib/design-session/file-extraction";
import {
  getProjectDesignSystem,
  getDesignSystemDownloadUrl,
  replaceProjectDesignSystem,
  deleteProjectDesignSystem,
} from "@/lib/dal/design-system";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const denied = await requireProjectViewApi(projectId);
  if (denied) return denied;

  try {
    const doc = await getProjectDesignSystem(projectId);
    if (!doc) return NextResponse.json({ designSystem: null });
    const downloadUrl = await getDesignSystemDownloadUrl(doc.id);
    return NextResponse.json({ designSystem: { ...doc, downloadUrl } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const denied = await requireCapabilityApi("project.configure", {
    projectId,
  });
  if (denied) return denied;

  const memberId = await getActorMemberId();
  if (!memberId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Envie um arquivo no campo `file`." },
      { status: 400 },
    );
  }
  if (isOverSizeLimit(file.size)) {
    return NextResponse.json(
      { error: "Arquivo acima de 25 MB." },
      { status: 413 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const doc = await replaceProjectDesignSystem({
      projectId,
      memberId,
      file: buffer,
      filename: file.name,
      mimeType: file.type,
    });
    const downloadUrl = await getDesignSystemDownloadUrl(doc.id);
    return NextResponse.json({ designSystem: { ...doc, downloadUrl } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upload failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const denied = await requireCapabilityApi("project.configure", {
    projectId,
  });
  if (denied) return denied;

  try {
    await deleteProjectDesignSystem(projectId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
