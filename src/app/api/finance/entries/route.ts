import { NextResponse } from "next/server";

import { requireMinAccessLevelApi } from "@/lib/dal";
import { createEntry, listEntries } from "@/lib/finance/dal";
import type { EntryInput } from "@/lib/finance/types";

/** GET /api/finance/entries?categoryId=&projectId= — itens (drill). Admin-only. */
export async function GET(req: Request) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  try {
    const entries = await listEntries({
      categoryId: searchParams.get("categoryId") || undefined,
      projectId: searchParams.get("projectId") || undefined,
    });
    return NextResponse.json({ entries });
  } catch (e) {
    console.error("[/api/finance/entries GET]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** POST /api/finance/entries — cria transação. Admin-only. */
export async function POST(req: Request) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;
  let body: EntryInput;
  try {
    body = (await req.json()) as EntryInput;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  try {
    return NextResponse.json({ entry: await createEntry(body) }, { status: 201 });
  } catch (e) {
    // Erros aqui são de validação/constraint (input do usuário) → 400.
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
