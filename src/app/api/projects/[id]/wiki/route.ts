import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/dal";

const DEFAULT_SECTIONS = [
  { sectionKey: "description", title: "Descrição do Projeto", order: 0 },
  { sectionKey: "links", title: "Links Rápidos", order: 1 },
  { sectionKey: "sponsors", title: "Sponsors", order: 2 },
  { sectionKey: "objectives", title: "Objetivos", order: 3 },
  { sectionKey: "success_indicators", title: "KPIs / Métricas", order: 4 },
  { sectionKey: "environments", title: "Ambientes", order: 5 },
  { sectionKey: "access", title: "Acessos", order: 6 },
];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const supabase = db();

  // Check project exists
  const { data: project } = await supabase
    .from("Project")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Use RPC to atomically ensure all sections exist
  const { data: sections, error } = await supabase.rpc("ensure_wiki_sections", {
    p_project_id: id,
    p_sections: DEFAULT_SECTIONS,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(sections);
}
