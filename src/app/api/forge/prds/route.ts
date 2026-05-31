import { NextResponse } from "next/server";
import { listPrds } from "@/lib/forge/prd-fs";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }
  const prds = await listPrds();
  return NextResponse.json({ prds, count: prds.length });
}
