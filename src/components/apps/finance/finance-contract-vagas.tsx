"use client";

/**
 * Equipe do contrato — VAGA-FIRST (F2.4). O contrato demanda funções (vagas);
 * a pessoa OCUPA a vaga. Mostra previsto × preenchido (buraco visível), a
 * sucessão de ocupantes e o custo por ocupante. PM é vaga derivada de pmId
 * (com custo, como builder). Substitui o ContractTeamEditor plano.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, MoreVertical, Users } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FormBody } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { brlFromCents } from "@/lib/format-currency";
import { fmtDate } from "@/lib/date-utils";
import { POSITIONS, POSITION_LABELS, positionLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type {
  AllocationItem,
  MemberRef,
  VagasResponse,
  VagaWithFill,
  PmVaga,
} from "@/lib/finance/types";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthISO(): string {
  return new Date().toISOString().slice(0, 8) + "01";
}

type TempStatus = "agendado" | "alocado" | "encerrado";
function temporalStatus(a: AllocationItem, today: string): TempStatus {
  if (a.effective_from > today) return "agendado";
  if (!a.effective_to || a.effective_to >= today) return "alocado";
  return "encerrado";
}

export function ContractVagasEditor({
  projectId,
  contractId,
  allocations,
  members,
  squadMemberIds,
  onChanged,
}: {
  projectId: string;
  contractId: string;
  allocations: AllocationItem[];
  members: MemberRef[];
  squadMemberIds: string[];
  onChanged: () => void;
}) {
  const [data, setData] = useState<VagasResponse | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  // form de atribuir (vaga vazia OU custo do PM): vagaId null = PM
  const [assign, setAssign] = useState<{ vagaId: string | null; memberId: string; role: string } | null>(null);
  // form de trocar ocupante
  const [replace, setReplace] = useState<{ vagaId: string; occ: AllocationItem; role: string } | null>(null);
  // form de nova vaga
  const [newVaga, setNewVaga] = useState<{ position: string; label: string } | null>(null);
  // form de participação pontual (spot — não é vaga)
  const [spotOpen, setSpotOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchOrThrow(`/api/finance/contract/${contractId}/vagas`);
      setData((await res.json()) as VagasResponse);
    } catch (e) {
      showErrorToast(e, { label: "Falha ao carregar vagas" });
      setData({ vagas: [], pm: { memberId: null, memberName: null, hasCost: false, allocationId: null }, summary: { total: 0, filled: 0, empty: 0 } });
    }
  }, [contractId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // ocupante atual de cada vaga = alocação ativa (não-void) com aquele vaga_id
  const today = todayISO();
  const occByVaga = useMemo(() => {
    const m = new Map<string, AllocationItem>();
    for (const a of allocations) {
      if (a.contract_id !== contractId || a.vaga_id == null || a.voided_at) continue;
      if (a.effective_to && a.effective_to < today) continue; // já encerrada
      const cur = m.get(a.vaga_id);
      if (!cur || a.effective_from > cur.effective_from) m.set(a.vaga_id, a);
    }
    return m;
  }, [allocations, contractId, today]);

  const memberOptions = useMemo(() => {
    const squad = new Set(squadMemberIds);
    return members
      .filter((m) => !m.isExternal)
      .sort((a, b) => (squad.has(a.id) ? 0 : 1) - (squad.has(b.id) ? 0 : 1) || a.name.localeCompare(b.name));
  }, [members, squadMemberIds]);

  async function refresh() {
    await load();
    onChanged();
  }

  // ── ações ──────────────────────────────────────────────────────────────────
  function encerrar(a: AllocationItem, who: string) {
    setConfirm({
      title: `Encerrar ${who}?`,
      description: `Marca a saída em ${fmtDate(today)}. O período fica no histórico e conta no billing até a data. A vaga fica vazia.`,
      confirmLabel: "Encerrar",
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/finance/allocations/${a.id}/close`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ effectiveTo: today }),
          });
          await refresh();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao encerrar" });
        }
      },
    });
  }
  function removerVaga(v: VagaWithFill) {
    setConfirm({
      title: "Remover esta vaga?",
      description: "A função deixa de ser demandada. Ocupações passadas são preservadas (o custo não some).",
      destructive: true,
      confirmLabel: "Remover vaga",
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/finance/contract/${contractId}/vagas/${v.id}`, { method: "DELETE" });
          await refresh();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao remover vaga" });
        }
      },
    });
  }

  if (!data) {
    return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;
  }

  const { vagas, pm, summary } = data;
  // spot (pontual) — não é vaga; ajuda ad-hoc em horas.
  const spots = allocations.filter(
    (a) => a.contract_id === contractId && a.kind === "spot" && !a.voided_at &&
      (!a.effective_to || a.effective_to >= today),
  );
  // custo do time = soma do custo dos ocupantes atuais (laborCents da alocação ativa)
  const teamCost = [...occByVaga.values()].reduce((s, a) => s + (a.laborCents ?? 0), 0)
    + (pm.allocationId ? (allocations.find((a) => a.id === pm.allocationId)?.laborCents ?? 0) : 0);

  return (
    <div>
      {/* cabeçalho: previsto × preenchido */}
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Users className="size-3.5" /> Equipe do contrato
        </p>
        <span className="text-xs text-muted-foreground">
          <b className="text-foreground">{summary.total} vagas</b> · {summary.filled} ocupadas
          {summary.empty > 0 && <> · <b className="text-amber-500">{summary.empty} vazia{summary.empty > 1 ? "s" : ""}</b></>}
        </span>
      </div>

      <div className="surface divide-y divide-border/60 overflow-hidden rounded-md">
        {/* PM (vaga derivada) */}
        <PmRow
          pm={pm}
          alloc={pm.allocationId ? allocations.find((a) => a.id === pm.allocationId) ?? null : null}
          today={today}
          onAllocCost={() => pm.memberId && setAssign({ vagaId: null, memberId: pm.memberId, role: "PM" })}
        />

        {/* Builders / demais vagas */}
        {vagas.map((v) => {
          const occ = occByVaga.get(v.id) ?? null;
          const role = `${positionLabel(v.position)}${v.label ? ` · ${v.label}` : ` · ${v.seq}`}`;
          return (
            <VagaRow
              key={v.id}
              role={role}
              occ={occ}
              today={today}
              onAssign={() => setAssign({ vagaId: v.id, memberId: "", role })}
              onReplace={occ ? () => setReplace({ vagaId: v.id, occ, role }) : undefined}
              onEncerrar={occ ? () => encerrar(occ, occ.memberName) : undefined}
              onRemoverVaga={() => removerVaga(v)}
            />
          );
        })}
      </div>

      {/* participação pontual (spot) — fora das vagas */}
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Participação pontual
          </p>
          <Button size="sm" variant="ghost" onClick={() => setSpotOpen(true)}>
            <Plus className="size-3.5" /> Pontual
          </Button>
        </div>
        {spots.length > 0 ? (
          <div className="surface divide-y divide-border/60 overflow-hidden rounded-md">
            {spots.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">{s.memberName}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.days}h · {fmtDate(s.effective_from)} · {brlFromCents(s.laborCents ?? 0)}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px] text-amber-600 border-amber-500/30">pontual</Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground/50">Sem ajuda pontual neste contrato.</p>
        )}
      </div>

      {/* rodapé: custo + nova vaga */}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Custo do time: <b className="font-mono text-foreground">{brlFromCents(teamCost)}/mês</b>
        </span>
        <Button size="sm" variant="outline" onClick={() => setNewVaga({ position: "product-builder", label: "" })}>
          <Plus className="size-3.5" /> Vaga
        </Button>
      </div>

      {/* dialogs */}
      {assign && (
        <AssignDialog
          key={assign.vagaId ?? "pm"}
          role={assign.role}
          isPm={assign.vagaId === null}
          fixedMemberId={assign.vagaId === null ? assign.memberId : null}
          memberOptions={memberOptions}
          onClose={() => setAssign(null)}
          onSubmit={async ({ memberId, percent, from }) => {
            await fetchOrThrow("/api/finance/allocations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                memberId,
                projectId,
                kind: "standing",
                percent,
                effectiveFrom: from,
                contractId,
                vagaId: assign.vagaId, // null pro PM (custo sem vaga)
              }),
            });
            setAssign(null);
            await refresh();
          }}
        />
      )}

      {replace && (
        <ReplaceDialog
          key={replace.vagaId}
          role={replace.role}
          occ={replace.occ}
          memberOptions={memberOptions}
          onClose={() => setReplace(null)}
          onSubmit={async ({ effectiveTo, newMemberId, newPercent, newFrom }) => {
            await fetchOrThrow(`/api/finance/contract/${contractId}/vagas/${replace.vagaId}/replace`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                currentAllocationId: replace.occ.id,
                effectiveTo,
                newMemberId,
                newPercent,
                newEffectiveFrom: newFrom,
              }),
            });
            setReplace(null);
            await refresh();
          }}
        />
      )}

      {newVaga && (
        <NewVagaDialog
          onClose={() => setNewVaga(null)}
          onSubmit={async ({ position, label }) => {
            await fetchOrThrow(`/api/finance/contract/${contractId}/vagas`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ position, label: label || null, effectiveFrom: firstOfMonthISO() }),
            });
            setNewVaga(null);
            await refresh();
          }}
        />
      )}

      {spotOpen && (
        <SpotDialog
          memberOptions={memberOptions}
          onClose={() => setSpotOpen(false)}
          onSubmit={async ({ memberId, hours, from }) => {
            await fetchOrThrow("/api/finance/allocations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                memberId,
                projectId,
                kind: "spot",
                days: hours,
                effectiveFrom: from,
                contractId,
              }),
            });
            setSpotOpen(false);
            await refresh();
          }}
        />
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

// ─── linhas ───────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: TempStatus }) {
  const map: Record<TempStatus, { label: string; cls: string }> = {
    agendado: { label: "Agendado", cls: "border-sky-500/40 text-sky-600" },
    alocado: { label: "Alocado", cls: "border-emerald-500/40 text-emerald-600" },
    encerrado: { label: "Encerrado", cls: "border-muted-foreground/40 text-muted-foreground" },
  };
  const s = map[status];
  return <Badge variant="outline" className={cn("shrink-0 text-[10px]", s.cls)}>{s.label}</Badge>;
}

function RoleLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-[120px] shrink-0 pt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

function PmRow({
  pm,
  alloc,
  today,
  onAllocCost,
}: {
  pm: PmVaga;
  alloc: AllocationItem | null | undefined;
  today: string;
  onAllocCost: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <RoleLabel>PM</RoleLabel>
      <div className="min-w-0 flex-1">
        {pm.memberId ? (
          <>
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="truncate">{pm.memberName}</span>
              {alloc ? <StatusChip status={temporalStatus(alloc, today)} /> : (
                <Badge variant="outline" className="shrink-0 text-[10px] border-amber-500/40 text-amber-500">sem custo</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {alloc
                ? `${alloc.percent}% · desde ${fmtDate(alloc.effective_from)} · ${brlFromCents(alloc.laborCents ?? 0)}/mês`
                : "gestor do projeto — custo não alocado neste contrato"}
            </p>
          </>
        ) : (
          <div className="text-sm text-muted-foreground/60 italic">— sem PM definido —</div>
        )}
      </div>
      <div className="flex shrink-0 items-center">
        {pm.memberId && !alloc && (
          <Button size="sm" variant="outline" onClick={onAllocCost}>Alocar custo</Button>
        )}
      </div>
    </div>
  );
}

function VagaRow({
  role,
  occ,
  today,
  onAssign,
  onReplace,
  onEncerrar,
  onRemoverVaga,
}: {
  role: string;
  occ: AllocationItem | null;
  today: string;
  onAssign: () => void;
  onReplace?: () => void;
  onEncerrar?: () => void;
  onRemoverVaga: () => void;
}) {
  return (
    <div className="group flex items-start gap-3 px-3 py-2.5">
      <RoleLabel>{role}</RoleLabel>
      <div className="min-w-0 flex-1">
        {occ ? (
          <>
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="truncate">{occ.memberName}</span>
              <StatusChip status={temporalStatus(occ, today)} />
            </div>
            <p className="text-xs text-muted-foreground">
              {occ.percent}% · {fmtDate(occ.effective_from)} →{" "}
              {occ.effective_to ? fmtDate(occ.effective_to) : "vigente"} · {brlFromCents(occ.laborCents ?? 0)}/mês
            </p>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm italic text-muted-foreground/60">— vazio —</span>
            <Badge variant="outline" className="shrink-0 text-[10px] border-amber-500/40 text-amber-500">Vaga aberta</Badge>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!occ && (
          <Button size="sm" variant="outline" onClick={onAssign}>Atribuir pessoa</Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-7 opacity-0 group-hover:opacity-100" />}>
            <MoreVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {occ && onReplace && <DropdownMenuItem onClick={onReplace}>Trocar ocupante</DropdownMenuItem>}
            {occ && onEncerrar && <DropdownMenuItem onClick={onEncerrar}>Encerrar</DropdownMenuItem>}
            {!occ && <DropdownMenuItem onClick={onAssign}>Atribuir pessoa</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onRemoverVaga}>Remover vaga</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

// ─── dialogs ────────────────────────────────────────────────────────────────

function MemberSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  options: MemberRef[];
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? "")} disabled={disabled}>
      <SelectTrigger>
        <SelectValue>
          {(v: string | null) => options.find((m) => m.id === v)?.name ?? "Selecione…"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.name}{m.position ? ` · ${positionLabel(m.position)}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AssignDialog({
  role,
  isPm,
  fixedMemberId,
  memberOptions,
  onClose,
  onSubmit,
}: {
  role: string;
  isPm: boolean;
  fixedMemberId: string | null;
  memberOptions: MemberRef[];
  onClose: () => void;
  onSubmit: (v: { memberId: string; percent: number; from: string }) => Promise<void>;
}) {
  const [memberId, setMemberId] = useState(fixedMemberId ?? "");
  const [percent, setPercent] = useState("100");
  const [from, setFrom] = useState(firstOfMonthISO());
  const [busy, setBusy] = useState(false);
  const pct = parseFloat(percent.replace(",", "."));
  const valid = memberId && from && pct > 0 && pct <= 100;

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isPm ? "Alocar custo do PM" : `Atribuir pessoa · ${role}`}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {isPm ? "Registra o custo do PM neste contrato (entra na margem)." : "A pessoa passa a ocupar esta vaga."}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="py-4">
          <FormBody density="compact">
            <Field name="member" required>
              <Field.Label>Membro</Field.Label>
              <Field.Control>
                <MemberSelect value={memberId} onChange={setMemberId} options={memberOptions} disabled={isPm} />
              </Field.Control>
            </Field>
            <Field.Row cols={2}>
              <Field name="pct" required>
                <Field.Label>%</Field.Label>
                <Field.Control><Input type="number" value={percent} onChange={(e) => setPercent(e.target.value)} /></Field.Control>
              </Field>
              <Field name="from" required>
                <Field.Label>Desde</Field.Label>
                <Field.Control><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field.Control>
              </Field>
            </Field.Row>
          </FormBody>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              try { await onSubmit({ memberId, percent: pct, from }); }
              catch (e) { showErrorToast(e, { label: "Falha ao atribuir" }); }
              finally { setBusy(false); }
            }}
          >
            {busy ? "Salvando…" : "Atribuir"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function ReplaceDialog({
  role,
  occ,
  memberOptions,
  onClose,
  onSubmit,
}: {
  role: string;
  occ: AllocationItem;
  memberOptions: MemberRef[];
  onClose: () => void;
  onSubmit: (v: { effectiveTo: string; newMemberId: string; newPercent: number; newFrom: string }) => Promise<void>;
}) {
  const [effectiveTo, setEffectiveTo] = useState(todayISO());
  const [newMemberId, setNewMemberId] = useState("");
  const [newPercent, setNewPercent] = useState(occ.percent != null ? String(occ.percent) : "100");
  const [newFrom, setNewFrom] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const pct = parseFloat(newPercent.replace(",", "."));
  const valid = newMemberId && effectiveTo && newFrom && pct > 0 && pct <= 100 && newFrom >= effectiveTo;

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Trocar ocupante · {role}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {occ.memberName} fica como &quot;Substituída&quot;; o histórico é mantido.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="py-4">
          <FormBody density="compact">
            <Field name="to">
              <Field.Label>Saindo: {occ.memberName} · última data</Field.Label>
              <Field.Control><Input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} /></Field.Control>
            </Field>
            <Field name="newm" required>
              <Field.Label>Entrando</Field.Label>
              <Field.Control><MemberSelect value={newMemberId} onChange={setNewMemberId} options={memberOptions} /></Field.Control>
            </Field>
            <Field.Row cols={2}>
              <Field name="newpct" required>
                <Field.Label>%</Field.Label>
                <Field.Control><Input type="number" value={newPercent} onChange={(e) => setNewPercent(e.target.value)} /></Field.Control>
              </Field>
              <Field name="newfrom" required>
                <Field.Label>A partir de</Field.Label>
                <Field.Control><Input type="date" value={newFrom} onChange={(e) => setNewFrom(e.target.value)} /></Field.Control>
              </Field>
            </Field.Row>
          </FormBody>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              try { await onSubmit({ effectiveTo, newMemberId, newPercent: pct, newFrom }); }
              catch (e) { showErrorToast(e, { label: "Falha ao trocar ocupante" }); }
              finally { setBusy(false); }
            }}
          >
            {busy ? "Trocando…" : "Trocar"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function SpotDialog({
  memberOptions,
  onClose,
  onSubmit,
}: {
  memberOptions: MemberRef[];
  onClose: () => void;
  onSubmit: (v: { memberId: string; hours: number; from: string }) => Promise<void>;
}) {
  const [memberId, setMemberId] = useState("");
  const [hours, setHours] = useState("");
  const [from, setFrom] = useState(firstOfMonthISO());
  const [busy, setBusy] = useState(false);
  const h = parseFloat(hours.replace(",", "."));
  const valid = memberId && from && h > 0 && h <= 160;

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Participação pontual</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Ajuda ad-hoc em horas (não é vaga). Custo = salário-mês ÷ 160h × horas.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="py-4">
          <FormBody density="compact">
            <Field name="member" required>
              <Field.Label>Membro</Field.Label>
              <Field.Control><MemberSelect value={memberId} onChange={setMemberId} options={memberOptions} /></Field.Control>
            </Field>
            <Field.Row cols={2}>
              <Field name="hours" required>
                <Field.Label>Horas</Field.Label>
                <Field.Control><Input type="number" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="ex: 16" /></Field.Control>
              </Field>
              <Field name="from" required>
                <Field.Label>Mês</Field.Label>
                <Field.Control><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field.Control>
              </Field>
            </Field.Row>
          </FormBody>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              try { await onSubmit({ memberId, hours: h, from }); }
              catch (e) { showErrorToast(e, { label: "Falha ao criar pontual" }); }
              finally { setBusy(false); }
            }}
          >
            {busy ? "Criando…" : "Criar"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function NewVagaDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (v: { position: string; label: string }) => Promise<void>;
}) {
  const [position, setPosition] = useState("product-builder");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Nova vaga</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Uma função que o contrato demanda (fica vazia até atribuir).</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="py-4">
          <FormBody density="compact">
            <Field name="pos" required>
              <Field.Label>Função</Field.Label>
              <Field.Control>
                <Select value={position} onValueChange={(v) => v && setPosition(v)}>
                  <SelectTrigger>
                    <SelectValue>{(v: string | null) => (v ? POSITION_LABELS[v as keyof typeof POSITION_LABELS] : "Selecione…")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {POSITIONS.map((p) => <SelectItem key={p} value={p}>{POSITION_LABELS[p]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field.Control>
            </Field>
            <Field name="label">
              <Field.Label>Rótulo (opcional)</Field.Label>
              <Field.Control><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex: Builder Backend" /></Field.Control>
            </Field>
          </FormBody>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await onSubmit({ position, label }); }
              catch (e) { showErrorToast(e, { label: "Falha ao criar vaga" }); }
              finally { setBusy(false); }
            }}
          >
            {busy ? "Criando…" : "Criar vaga"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
