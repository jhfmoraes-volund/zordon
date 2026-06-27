import { NextResponse } from "next/server";

import { requireCapabilityApi } from "@/lib/access/require-capability";
import { createInvoice, listInvoices } from "@/lib/finance/dal";
import type { InvoiceInput } from "@/lib/finance/types";

/** GET /api/finance/invoice?contractId= | ?projectId= — NFs (cobrança). Admin-only. */
export async function GET(req: Request) {
  const denied = await requireCapabilityApi("finance.access");
  if (denied) return denied;
  const url = new URL(req.url);
  const contractId = url.searchParams.get("contractId") ?? undefined;
  const projectId = url.searchParams.get("projectId") ?? undefined;
  if (!contractId && !projectId)
    return NextResponse.json({ error: "contractId ou projectId obrigatório" }, { status: 400 });
  try {
    return NextResponse.json({ invoices: await listInvoices({ contractId, projectId }) });
  } catch (e) {
    console.error("[/api/finance/invoice GET]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** POST /api/finance/invoice — emite/cria uma NF (humano; ver Q1/agente humano-only). Admin-only. */
export async function POST(req: Request) {
  const denied = await requireCapabilityApi("finance.access");
  if (denied) return denied;
  let body: InvoiceInput;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  try {
    return NextResponse.json({ invoice: await createInvoice(body) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
