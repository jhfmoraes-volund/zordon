import { NextRequest, NextResponse } from "next/server";
import { getCurrentMember, getUser } from "@/lib/dal";
import {
  getMemberIntegrationStatus,
  setMemberRoamIntegration,
  deleteMemberIntegration,
  type IntegrationProvider,
} from "@/lib/member-integrations";

const SUPPORTED: IntegrationProvider[] = ["roam"];

function parseProvider(raw: string): IntegrationProvider | null {
  return (SUPPORTED as string[]).includes(raw) ? (raw as IntegrationProvider) : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "No member linked" }, { status: 404 });

  const { provider: providerRaw } = await params;
  const provider = parseProvider(providerRaw);
  if (!provider) return new NextResponse("Unknown provider", { status: 400 });

  const status = await getMemberIntegrationStatus(member.id, provider);
  return NextResponse.json(status);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "No member linked" }, { status: 404 });

  const { provider: providerRaw } = await params;
  const provider = parseProvider(providerRaw);
  if (!provider) return new NextResponse("Unknown provider", { status: 400 });

  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  const token = body?.token;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Token requerido" }, { status: 400 });
  }

  try {
    if (provider === "roam") {
      await setMemberRoamIntegration(member.id, token);
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const status = await getMemberIntegrationStatus(member.id, provider);
  return NextResponse.json(status);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const member = await getCurrentMember();
  if (!member) return NextResponse.json({ error: "No member linked" }, { status: 404 });

  const { provider: providerRaw } = await params;
  const provider = parseProvider(providerRaw);
  if (!provider) return new NextResponse("Unknown provider", { status: 400 });

  await deleteMemberIntegration(member.id, provider);
  return NextResponse.json({ connected: false, tokenHint: null, updatedAt: null });
}
