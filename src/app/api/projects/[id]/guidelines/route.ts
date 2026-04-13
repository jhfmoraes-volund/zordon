import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_GUIDELINES } from "@/lib/default-guidelines";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const guidelines = await prisma.projectGuideline.findMany({
    where: { projectId: id },
    orderBy: { category: "asc" },
  });

  return NextResponse.json(guidelines);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  // If "loadDefaults" is true, upsert all default guidelines
  if (body.loadDefaults) {
    const results = await Promise.all(
      DEFAULT_GUIDELINES.map((g) =>
        prisma.projectGuideline.upsert({
          where: { projectId_category: { projectId: id, category: g.category } },
          create: {
            projectId: id,
            category: g.category,
            title: g.title,
            content: g.content,
            isDefault: true,
          },
          update: {
            title: g.title,
            content: g.content,
            isDefault: true,
          },
        })
      )
    );
    return NextResponse.json(results, { status: 201 });
  }

  // Single guideline upsert
  const { category, title, content } = body;
  const guideline = await prisma.projectGuideline.upsert({
    where: { projectId_category: { projectId: id, category } },
    create: { projectId: id, category, title, content },
    update: { title, content, isDefault: false },
  });

  return NextResponse.json(guideline, { status: 201 });
}
