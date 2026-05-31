import { NextResponse } from "next/server";
import { readPrd } from "@/lib/forge/prd-fs";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }
  const { slug } = await params;
  const prd = await readPrd(slug);
  if (!prd) {
    return NextResponse.json({ error: "PRD not found", slug }, { status: 404 });
  }
  return NextResponse.json(prd);
}
