import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const DEFAULT_SECTIONS = [
  { sectionKey: "links", title: "Links Úteis", order: 0 },
  { sectionKey: "sponsors", title: "Sponsors", order: 1 },
  { sectionKey: "success_indicators", title: "Indicadores de Sucesso", order: 2 },
  { sectionKey: "objectives", title: "Objetivos", order: 3 },
  { sectionKey: "scope", title: "Escopo", order: 4 },
];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Check project exists
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Auto-create sections if they don't exist
  const existing = await prisma.projectWikiSection.findMany({
    where: { projectId: id },
    orderBy: { order: "asc" },
  });

  if (existing.length === 0) {
    await prisma.$transaction(
      DEFAULT_SECTIONS.map((section) =>
        prisma.projectWikiSection.create({
          data: {
            projectId: id,
            sectionKey: section.sectionKey,
            title: section.title,
            order: section.order,
            data: "[]",
          },
        })
      )
    );

    const created = await prisma.projectWikiSection.findMany({
      where: { projectId: id },
      orderBy: { order: "asc" },
    });
    return NextResponse.json(created);
  }

  // Create any missing sections
  const existingKeys = new Set(existing.map((s) => s.sectionKey));
  const missing = DEFAULT_SECTIONS.filter((s) => !existingKeys.has(s.sectionKey));

  if (missing.length > 0) {
    await prisma.$transaction(
      missing.map((section) =>
        prisma.projectWikiSection.create({
          data: {
            projectId: id,
            sectionKey: section.sectionKey,
            title: section.title,
            order: section.order,
            data: "[]",
          },
        })
      )
    );

    const all = await prisma.projectWikiSection.findMany({
      where: { projectId: id },
      orderBy: { order: "asc" },
    });
    return NextResponse.json(all);
  }

  return NextResponse.json(existing);
}
