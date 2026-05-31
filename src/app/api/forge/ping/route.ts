import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const dev = process.env.NODE_ENV !== "production";
  if (!dev) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.json({ dev: true, ts: new Date().toISOString() });
}
