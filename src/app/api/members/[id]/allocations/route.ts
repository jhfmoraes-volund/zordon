import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { requireMinAccessLevelApi } from "@/lib/dal";
import {
  listAllocations,
  createAllocation,
  updateAllocation,
  deleteAllocation,
  listContracts,
} from "@/lib/finance/dal";

/**
 * GET/PUT /api/members/[id]/allocations — alocação do membro em projetos. Admin-only.
 *
 * Centraliza os DOIS modelos de alocação que coexistem no Zordon, pra manter o
 * Member Sheet simples (uma chamada, um payload):
 *   - **PFV/sprint** (teto de planejamento) → `ProjectMember.fpAllocation`.
 *   - **% + contrato** (custo/financeiro)   → `finance.labor_allocation`.
 *
 * GET devolve uma linha por projeto, mesclando os dois números + lista de
 * projetos e contratos disponíveis. PUT recebe o conjunto desejado e faz diff.
 */

type AllocationRow = {
  projectId: string;
  projectName: string;
  /** Teto de PFV/sprint (ProjectMember). 0 = sem teto definido. */
  fpAllocation: number;
  /** id da labor_allocation vigente (null = nenhuma ainda). */
  allocationId: string | null;
  percent: number | null;
  contractId: string | null;
  contractLabel: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

type ContractLite = {
  id: string;
  label: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

type MemberAllocationState = {
  fpCapacity: number;
  allocations: AllocationRow[];
  projects: { id: string; name: string }[];
  contractsByProject: Record<string, ContractLite[]>;
};

/** Estado mesclado das alocações do membro — base do GET e da resposta do PUT. */
async function buildState(memberId: string): Promise<MemberAllocationState | null> {
  const supabase = db();

  const [memberRes, pmRes, projectsRes, allocs] = await Promise.all([
    supabase.from("Member").select("id, fpCapacity").eq("id", memberId).maybeSingle(),
    supabase.from("ProjectMember").select("projectId, fpAllocation").eq("memberId", memberId),
    supabase.from("Project").select("id, name").order("name"),
    listAllocations({ memberId }), // ordenado por effective_from desc
  ]);

  if (!memberRes.data) return null;

  const projectNames = new Map<string, string>(
    (projectsRes.data ?? []).map((p) => [p.id, p.name]),
  );

  const rowByProject = new Map<string, AllocationRow>();
  const ensureRow = (projectId: string): AllocationRow => {
    let row = rowByProject.get(projectId);
    if (!row) {
      row = {
        projectId,
        projectName: projectNames.get(projectId) ?? "—",
        fpAllocation: 0,
        allocationId: null,
        percent: null,
        contractId: null,
        contractLabel: null,
        effectiveFrom: null,
        effectiveTo: null,
      };
      rowByProject.set(projectId, row);
    }
    return row;
  };

  for (const pm of pmRes.data ?? []) {
    ensureRow(pm.projectId).fpAllocation = pm.fpAllocation ?? 0;
  }

  // listAllocations vem desc por effective_from → a 1ª por projeto é a vigente.
  for (const a of allocs) {
    const row = ensureRow(a.project_id);
    if (row.allocationId === null) {
      row.allocationId = a.id;
      row.percent = Number(a.percent);
      row.contractId = a.contract_id;
      row.effectiveFrom = a.effective_from;
      row.effectiveTo = a.effective_to;
    }
  }

  // Contratos dos projetos já alocados (pro dropdown abrir preenchido) +
  // resolução do label do contrato vigente em cada linha.
  const contractsByProject: Record<string, ContractLite[]> = {};
  await Promise.all(
    [...rowByProject.keys()].map(async (projectId) => {
      const contracts = await listContracts(projectId);
      contractsByProject[projectId] = contracts.map((c) => ({
        id: c.id,
        label: c.label,
        effectiveFrom: c.effectiveFrom,
        effectiveTo: c.effectiveTo,
      }));
    }),
  );
  for (const row of rowByProject.values()) {
    if (row.contractId) {
      row.contractLabel =
        contractsByProject[row.projectId]?.find((c) => c.id === row.contractId)?.label ?? null;
    }
  }

  return {
    fpCapacity: memberRes.data.fpCapacity ?? 0,
    allocations: [...rowByProject.values()].sort((a, b) =>
      a.projectName.localeCompare(b.projectName),
    ),
    projects: (projectsRes.data ?? []).map((p) => ({ id: p.id, name: p.name })),
    contractsByProject,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;

  const { id } = await params;
  const state = await buildState(id);
  if (!state) return NextResponse.json({ error: "Membro não encontrado" }, { status: 404 });
  return NextResponse.json(state);
}

type DesiredRow = {
  projectId: string;
  fpAllocation?: number;
  percent?: number | null;
  contractId?: string | null;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  allocationId?: string | null;
};

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireMinAccessLevelApi("admin");
  if (denied) return denied;

  const { id: memberId } = await params;
  const supabase = db();

  const { data: member } = await supabase
    .from("Member")
    .select("id, fpCapacity")
    .eq("id", memberId)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Membro não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const desired: DesiredRow[] = Array.isArray(body?.allocations) ? body.allocations : [];

  // Validações básicas + Σ PFV ≤ capacidade.
  let sumFp = 0;
  for (const d of desired) {
    if (!d.projectId || typeof d.projectId !== "string") {
      return NextResponse.json({ error: "projectId obrigatório em cada linha" }, { status: 400 });
    }
    const fp = Number(d.fpAllocation ?? 0);
    if (!Number.isFinite(fp) || fp < 0) {
      return NextResponse.json({ error: "fpAllocation deve ser número ≥ 0" }, { status: 400 });
    }
    sumFp += fp;
    const pct = d.percent == null ? 0 : Number(d.percent);
    if (pct > 0 && !d.effectiveFrom) {
      return NextResponse.json(
        { error: "effectiveFrom obrigatório quando há percentual" },
        { status: 400 },
      );
    }
  }
  if (sumFp > (member.fpCapacity ?? 0)) {
    return NextResponse.json(
      { error: `Σ PFV (${sumFp}) excede a capacidade do membro (${member.fpCapacity})` },
      { status: 400 },
    );
  }

  // Estado atual (pra diff).
  const [pmRes, allocs] = await Promise.all([
    supabase.from("ProjectMember").select("id, projectId, fpAllocation").eq("memberId", memberId),
    listAllocations({ memberId }),
  ]);
  const currentPm = new Map((pmRes.data ?? []).map((r) => [r.projectId, r]));
  // alocação vigente (a 1ª por projeto, já que vem desc).
  const currentAllocByProject = new Map<string, { id: string; percent: number }>();
  for (const a of allocs) {
    if (!currentAllocByProject.has(a.project_id)) {
      currentAllocByProject.set(a.project_id, { id: a.id, percent: Number(a.percent) });
    }
  }

  const desiredProjects = new Set(desired.map((d) => d.projectId));

  try {
    // ── PFV (ProjectMember) ────────────────────────────────────────────────
    // Upsert dos projetos desejados; delete dos que saíram.
    for (const d of desired) {
      const fp = Number(d.fpAllocation ?? 0);
      const existing = currentPm.get(d.projectId);
      if (existing) {
        if (existing.fpAllocation !== fp) {
          const { error } = await supabase
            .from("ProjectMember")
            .update({ fpAllocation: fp })
            .eq("id", existing.id);
          if (error) throw new Error(error.message);
        }
      } else {
        const { error } = await supabase.from("ProjectMember").insert({
          id: crypto.randomUUID(),
          projectId: d.projectId,
          memberId,
          fpAllocation: fp,
        });
        if (error) throw new Error(error.message);
      }
    }
    for (const [projectId, pm] of currentPm) {
      if (!desiredProjects.has(projectId)) {
        const { error } = await supabase.from("ProjectMember").delete().eq("id", pm.id);
        if (error) throw new Error(error.message);
      }
    }

    // ── % (finance.labor_allocation) ───────────────────────────────────────
    // Aplica em ordem de delta crescente (reduções/remoções antes de aumentos)
    // pra nunca estourar 100% num passo intermediário — createAllocation/
    // updateAllocation validam Σ%≤100 lendo o estado do banco.
    type Op =
      | { kind: "delete"; allocationId: string; delta: number }
      | { kind: "upsert"; row: DesiredRow; delta: number };
    const ops: Op[] = [];

    for (const d of desired) {
      const pct = d.percent == null ? 0 : Number(d.percent);
      const current = currentAllocByProject.get(d.projectId);
      if (pct > 0) {
        ops.push({ kind: "upsert", row: d, delta: pct - (current?.percent ?? 0) });
      } else if (current) {
        // percentual zerado → remove a alocação vigente.
        ops.push({ kind: "delete", allocationId: current.id, delta: -current.percent });
      }
    }
    for (const [projectId, current] of currentAllocByProject) {
      if (!desiredProjects.has(projectId)) {
        ops.push({ kind: "delete", allocationId: current.id, delta: -current.percent });
      }
    }

    ops.sort((a, b) => a.delta - b.delta);

    for (const op of ops) {
      if (op.kind === "delete") {
        await deleteAllocation(op.allocationId);
      } else {
        const d = op.row;
        const input = {
          memberId,
          projectId: d.projectId,
          percent: Number(d.percent),
          effectiveFrom: d.effectiveFrom!,
          effectiveTo: d.effectiveTo ?? null,
          contractId: d.contractId ?? null,
        };
        const existingId = d.allocationId ?? currentAllocByProject.get(d.projectId)?.id ?? null;
        if (existingId) await updateAllocation(existingId, input);
        else await createAllocation(input);
      }
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const state = await buildState(memberId);
  return NextResponse.json(state);
}
