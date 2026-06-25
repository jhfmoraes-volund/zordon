"use client";

/**
 * Equipe do contrato — VAGA-FIRST, UMA fonte. O contrato demanda funções (vagas);
 * a pessoa OCUPA a vaga. Mostra previsto × preenchido, a sucessão e o custo por
 * ocupante.
 *
 * Modelo único (sem caso especial):
 *  - TODA função é uma contract_vaga, incluindo PM (position='pm'). Sem PM
 *    derivado, sem "órfão". Project.pmId é só identidade do projeto — não entra aqui.
 *  - Ocupante = alocação standing ativa com aquele vaga_id. 1 ocupante ativo/vaga.
 *  - O CONTRATO limita tudo: status e fim do ocupante param na vigência do
 *    contrato (effective_to do contrato). Datas herdam o contrato e são editáveis
 *    dentro de [início, fim].
 *  - Nome da função fica ACIMA do nome da pessoa (eyebrow), aproveitando a largura.
 *  - Deletar: "Remover" (soft, só vaga vazia) vs "Deletar" (hard, apaga vaga +
 *    ocupação, exige digitar DELETAR — pra erro/duplicata, sem manchar log).
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
import { DatePicker } from "@/components/ui/date-picker";
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
  ContractVaga,
  MemberRef,
  VagasResponse,
} from "@/lib/finance/types";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonthISO(): string {
  return new Date().toISOString().slice(0, 8) + "01";
}
/** Limita `iso` a [min, max] (max opcional). Vazio passa direto. */
function clampDate(iso: string, min: string, max: string | null): string {
  if (!iso) return iso;
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

/** Fim EFETIVO da ocupação = min(fim da alocação, fim do contrato). O contrato
 *  limita: alocação aberta num contrato encerrado termina na data do contrato. */
function effectiveEnd(a: AllocationItem, contractTo: string | null): string | null {
  if (a.effective_to && contractTo) return a.effective_to < contractTo ? a.effective_to : contractTo;
  return a.effective_to ?? contractTo ?? null;
}

type TempStatus = "agendado" | "alocado" | "encerrado";
function temporalStatus(a: AllocationItem, today: string, contractTo: string | null): TempStatus {
  if (a.effective_from > today) return "agendado";
  const end = effectiveEnd(a, contractTo);
  if (!end || end >= today) return "alocado";
  return "encerrado";
}

export function ContractVagasEditor({
  projectId,
  contractId,
  contractFrom,
  contractTo,
  allocations,
  members,
  squadMemberIds,
  onChanged,
  readOnly = false,
  title,
}: {
  projectId: string;
  contractId: string;
  /** Início da vigência do contrato (ISO) — vagas herdam e ficam limitadas a ele. */
  contractFrom: string;
  /** Fim da vigência (ISO) ou null (contrato em aberto). */
  contractTo: string | null;
  allocations: AllocationItem[];
  members: MemberRef[];
  squadMemberIds: string[];
  onChanged: () => void;
  /** Só leitura (ex.: no hub do projeto) — esconde toda ação; edição vive no sheet. */
  readOnly?: boolean;
  /** Rótulo do cabeçalho (default "Equipe do contrato"). No hub passa o nome do contrato. */
  title?: string;
}) {
  const [vagas, setVagas] = useState<ContractVaga[] | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  // form de atribuir pessoa a uma vaga vazia
  const [assign, setAssign] = useState<{ vagaId: string; role: string; defaultFrom: string } | null>(null);
  // form de trocar ocupante
  const [replace, setReplace] = useState<{ vagaId: string; occ: AllocationItem; role: string } | null>(null);
  // form de nova vaga
  const [newVaga, setNewVaga] = useState(false);
  // form de editar vaga
  const [editVaga, setEditVaga] = useState<ContractVaga | null>(null);
  // form de DELETAR (hard) — apaga vaga + ocupação; exige digitar DELETAR
  const [del, setDel] = useState<{ vaga: ContractVaga; role: string; occName: string | null } | null>(null);
  // form de participação pontual (spot — não é vaga)
  const [spotOpen, setSpotOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetchOrThrow(`/api/finance/contract/${contractId}/vagas`);
      setVagas(((await res.json()) as VagasResponse).vagas);
    } catch (e) {
      showErrorToast(e, { label: "Falha ao carregar vagas" });
      setVagas([]);
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

  // ocupante atual de cada vaga = alocação standing ativa (não-void, vigente) com o vaga_id
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
  // Remover vaga VAZIA (slot que não se demanda mais). Vaga ocupada → use Deletar.
  function removerVagaVazia(v: ContractVaga) {
    setConfirm({
      title: "Remover esta vaga?",
      description: "A função (vazia) deixa de ser demandada. Não afeta histórico nem custo.",
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

  if (!vagas) {
    return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>;
  }

  // spot (pontual) — não é vaga; ajuda ad-hoc em horas. Mostra TODAS as do
  // contrato (incl. passadas) — cada uma é custo real registrado num mês.
  const spots = allocations
    .filter((a) => a.contract_id === contractId && a.kind === "spot" && !a.voided_at)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  // custo do time = ocupantes atuais (todas as vagas, incl. PM).
  const teamCost = [...occByVaga.values()].reduce((s, a) => s + (a.laborCents ?? 0), 0);

  // previsto × preenchido — UMA fonte: as vagas. PM é vaga, conta normal.
  const total = vagas.length;
  const filled = vagas.filter((v) => occByVaga.has(v.id)).length;
  const empty = total - filled;

  return (
    <div>
      {/* cabeçalho: previsto × preenchido */}
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Users className="size-3.5" /> {title ?? "Equipe do contrato"}
        </p>
        <span className="text-xs text-muted-foreground">
          <b className="text-foreground">{total} vaga{total !== 1 ? "s" : ""}</b> · {filled} ocupada{filled !== 1 ? "s" : ""}
          {empty > 0 && <> · <b className="text-amber-500">{empty} vazia{empty !== 1 ? "s" : ""}</b></>}
        </span>
      </div>

      {vagas.length === 0 ? (
        <div className="surface rounded-md px-3 py-6 text-center text-sm text-muted-foreground">
          {readOnly ? "Nenhuma vaga neste contrato." : "Nenhuma vaga ainda — adicione as funções que o contrato demanda (incl. PM)."}
        </div>
      ) : (
        <div className="surface divide-y divide-border/60 overflow-hidden rounded-md">
          {vagas.map((v) => {
            const occ = occByVaga.get(v.id) ?? null;
            const role = roleLabel(v);
            return (
              <VagaRow
                key={v.id}
                role={role}
                occ={occ}
                today={today}
                contractTo={contractTo}
                readOnly={readOnly}
                onAssign={() =>
                  setAssign({ vagaId: v.id, role, defaultFrom: clampDate(v.effective_from, contractFrom, contractTo) })
                }
                onReplace={occ ? () => setReplace({ vagaId: v.id, occ, role }) : undefined}
                onEncerrar={occ ? () => encerrar(occ, occ.memberName) : undefined}
                onEditVaga={() => setEditVaga(v)}
                onRemoverVaga={!occ ? () => removerVagaVazia(v) : undefined}
                onDeletar={() => setDel({ vaga: v, role, occName: occ?.memberName ?? null })}
              />
            );
          })}
        </div>
      )}

      {/* participação pontual (spot) — fora das vagas */}
      {(spots.length > 0 || !readOnly) && (
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Participação pontual
          </p>
          {!readOnly && (
            <Button size="sm" variant="ghost" onClick={() => setSpotOpen(true)}>
              <Plus className="size-3.5" /> Pontual
            </Button>
          )}
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
      )}

      {/* rodapé: custo + nova vaga */}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Custo do time: <b className="font-mono text-foreground">{brlFromCents(teamCost)}/mês</b>
        </span>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={() => setNewVaga(true)}>
            <Plus className="size-3.5" /> Vaga
          </Button>
        )}
      </div>

      {/* dialogs */}
      {assign && (
        <AssignDialog
          key={assign.vagaId}
          role={assign.role}
          defaultFrom={assign.defaultFrom}
          contractFrom={contractFrom}
          contractTo={contractTo}
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
                vagaId: assign.vagaId,
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
          contractFrom={contractFrom}
          contractTo={contractTo}
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
          contractFrom={contractFrom}
          contractTo={contractTo}
          onClose={() => setNewVaga(false)}
          onSubmit={async ({ position, label, from, to }) => {
            await fetchOrThrow(`/api/finance/contract/${contractId}/vagas`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ position, label: label || null, effectiveFrom: from, effectiveTo: to || null }),
            });
            setNewVaga(false);
            await refresh();
          }}
        />
      )}

      {editVaga && (
        <EditVagaDialog
          key={editVaga.id}
          vaga={editVaga}
          contractFrom={contractFrom}
          contractTo={contractTo}
          onClose={() => setEditVaga(null)}
          onSubmit={async ({ label, from, to }) => {
            await fetchOrThrow(`/api/finance/contract/${contractId}/vagas/${editVaga.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ label: label || null, effectiveFrom: from, effectiveTo: to || null }),
            });
            setEditVaga(null);
            await refresh();
          }}
        />
      )}

      {spotOpen && (
        <SpotDialog
          contractFrom={contractFrom}
          contractTo={contractTo}
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

      {del && (
        <DeleteVagaDialog
          key={del.vaga.id}
          role={del.role}
          occName={del.occName}
          onClose={() => setDel(null)}
          onConfirm={async () => {
            await fetchOrThrow(`/api/finance/contract/${contractId}/vagas/${del.vaga.id}?hard=1`, {
              method: "DELETE",
            });
            setDel(null);
            await refresh();
          }}
        />
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

/** "Builder · 2" ou "Builder · Backend" (rótulo) — texto do eyebrow da vaga. */
function roleLabel(v: ContractVaga): string {
  return `${positionLabel(v.position)}${v.label ? ` · ${v.label}` : ` · ${v.seq}`}`;
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

/** Casca vertical: eyebrow (função) ACIMA, ações no topo-direito, corpo abaixo. */
function RowShell({
  eyebrow,
  topRight,
  children,
}: {
  eyebrow: React.ReactNode;
  topRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="group px-3 py-2.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {eyebrow}
        </span>
        <div className="flex shrink-0 items-center gap-1">{topRight}</div>
      </div>
      {children}
    </div>
  );
}

function OccBody({ name, status, sub }: { name: string; status: TempStatus; sub: string }) {
  return (
    <>
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="truncate">{name}</span>
        <StatusChip status={status} />
      </div>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </>
  );
}

function DotsMenu({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-7 opacity-60 group-hover:opacity-100" />}>
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Linha única — vale pra QUALQUER vaga (incl. PM). Ocupada ou vazia. */
function VagaRow({
  role,
  occ,
  today,
  contractTo,
  readOnly,
  onAssign,
  onReplace,
  onEncerrar,
  onEditVaga,
  onRemoverVaga,
  onDeletar,
}: {
  role: string;
  occ: AllocationItem | null;
  today: string;
  contractTo: string | null;
  readOnly?: boolean;
  onAssign: () => void;
  onReplace?: () => void;
  onEncerrar?: () => void;
  onEditVaga: () => void;
  /** Só pra vaga VAZIA (soft). Ocupada usa Deletar. */
  onRemoverVaga?: () => void;
  onDeletar: () => void;
}) {
  const end = occ ? effectiveEnd(occ, contractTo) : null;
  return (
    <RowShell
      eyebrow={role}
      topRight={
        readOnly ? undefined : (
        <>
          {!occ && <Button size="sm" variant="outline" onClick={onAssign}>Atribuir pessoa</Button>}
          <DotsMenu>
            {occ && onReplace && <DropdownMenuItem onClick={onReplace}>Trocar ocupante</DropdownMenuItem>}
            {occ && onEncerrar && <DropdownMenuItem onClick={onEncerrar}>Encerrar</DropdownMenuItem>}
            {!occ && <DropdownMenuItem onClick={onAssign}>Atribuir pessoa</DropdownMenuItem>}
            <DropdownMenuItem onClick={onEditVaga}>Editar vaga</DropdownMenuItem>
            <DropdownMenuSeparator />
            {onRemoverVaga && <DropdownMenuItem onClick={onRemoverVaga}>Remover vaga</DropdownMenuItem>}
            <DropdownMenuItem variant="destructive" onClick={onDeletar}>Deletar (apagar erro)</DropdownMenuItem>
          </DotsMenu>
        </>
        )
      }
    >
      {occ ? (
        <OccBody
          name={occ.memberName}
          status={temporalStatus(occ, today, contractTo)}
          sub={`${occ.percent}% · ${fmtDate(occ.effective_from)} → ${end ? fmtDate(end) : "vigente"} · ${brlFromCents(occ.laborCents ?? 0)}/mês`}
        />
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm italic text-muted-foreground/60">— vazio —</span>
          <Badge variant="outline" className="shrink-0 text-[10px] border-amber-500/40 text-amber-500">Vaga aberta</Badge>
        </div>
      )}
    </RowShell>
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
      <SelectTrigger className="w-full">
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

function ContractHint({ from, to }: { from: string; to: string | null }) {
  return (
    <p className="text-[11px] text-muted-foreground">
      Vigência do contrato: {fmtDate(from)} → {to ? fmtDate(to) : "em aberto"}. Datas ficam dentro dela.
    </p>
  );
}

function AssignDialog({
  role,
  defaultFrom,
  contractFrom,
  contractTo,
  memberOptions,
  onClose,
  onSubmit,
}: {
  role: string;
  defaultFrom: string;
  contractFrom: string;
  contractTo: string | null;
  memberOptions: MemberRef[];
  onClose: () => void;
  onSubmit: (v: { memberId: string; percent: number; from: string }) => Promise<void>;
}) {
  const [memberId, setMemberId] = useState("");
  const [percent, setPercent] = useState("100");
  const [from, setFrom] = useState(defaultFrom || contractFrom);
  const [busy, setBusy] = useState(false);
  const pct = parseFloat(percent.replace(",", "."));
  const inRange = from >= contractFrom && (!contractTo || from <= contractTo);
  const valid = memberId && from && inRange && pct > 0 && pct <= 100;

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Atribuir pessoa · {role}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>A pessoa passa a ocupar esta vaga.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="py-4">
          <FormBody density="compact">
            <Field name="member" required>
              <Field.Label>Membro</Field.Label>
              <Field.Control>
                <MemberSelect value={memberId} onChange={setMemberId} options={memberOptions} />
              </Field.Control>
            </Field>
            <Field.Row cols={2}>
              <Field name="pct" required>
                <Field.Label>%</Field.Label>
                <Field.Control><Input type="number" value={percent} onChange={(e) => setPercent(e.target.value)} /></Field.Control>
              </Field>
              <Field name="from" required>
                <Field.Label>Desde</Field.Label>
                <Field.Control>
                  <DatePicker value={from} onChange={setFrom} min={contractFrom} max={contractTo ?? undefined} />
                </Field.Control>
              </Field>
            </Field.Row>
            <ContractHint from={contractFrom} to={contractTo} />
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
  contractFrom,
  contractTo,
  memberOptions,
  onClose,
  onSubmit,
}: {
  role: string;
  occ: AllocationItem;
  contractFrom: string;
  contractTo: string | null;
  memberOptions: MemberRef[];
  onClose: () => void;
  onSubmit: (v: { effectiveTo: string; newMemberId: string; newPercent: number; newFrom: string }) => Promise<void>;
}) {
  const start = clampDate(todayISO(), contractFrom, contractTo);
  const [effectiveTo, setEffectiveTo] = useState(start);
  const [newMemberId, setNewMemberId] = useState("");
  const [newPercent, setNewPercent] = useState(occ.percent != null ? String(occ.percent) : "100");
  const [newFrom, setNewFrom] = useState(start);
  const [busy, setBusy] = useState(false);
  const pct = parseFloat(newPercent.replace(",", "."));
  const inRange =
    effectiveTo >= contractFrom && newFrom >= contractFrom &&
    (!contractTo || (effectiveTo <= contractTo && newFrom <= contractTo));
  const valid = newMemberId && effectiveTo && newFrom && pct > 0 && pct <= 100 && newFrom >= effectiveTo && inRange;

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
              <Field.Control>
                <DatePicker value={effectiveTo} onChange={setEffectiveTo} min={contractFrom} max={contractTo ?? undefined} />
              </Field.Control>
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
                <Field.Control>
                  <DatePicker value={newFrom} onChange={setNewFrom} min={effectiveTo || contractFrom} max={contractTo ?? undefined} />
                </Field.Control>
              </Field>
            </Field.Row>
            <ContractHint from={contractFrom} to={contractTo} />
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
  contractFrom,
  contractTo,
  memberOptions,
  onClose,
  onSubmit,
}: {
  contractFrom: string;
  contractTo: string | null;
  memberOptions: MemberRef[];
  onClose: () => void;
  onSubmit: (v: { memberId: string; hours: number; from: string }) => Promise<void>;
}) {
  const [memberId, setMemberId] = useState("");
  const [hours, setHours] = useState("");
  const [from, setFrom] = useState(clampDate(firstOfMonthISO(), contractFrom, contractTo));
  const [busy, setBusy] = useState(false);
  const h = parseFloat(hours.replace(",", "."));
  const inRange = from >= contractFrom && (!contractTo || from <= contractTo);
  const valid = memberId && from && inRange && h > 0 && h <= 160;

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
                <Field.Control>
                  <DatePicker value={from} onChange={setFrom} min={contractFrom} max={contractTo ?? undefined} />
                </Field.Control>
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

function PositionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger className="w-full">
        <SelectValue>{(v: string | null) => (v ? POSITION_LABELS[v as keyof typeof POSITION_LABELS] : "Selecione…")}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {POSITIONS.map((p) => <SelectItem key={p} value={p}>{POSITION_LABELS[p]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function NewVagaDialog({
  contractFrom,
  contractTo,
  onClose,
  onSubmit,
}: {
  contractFrom: string;
  contractTo: string | null;
  onClose: () => void;
  onSubmit: (v: { position: string; label: string; from: string; to: string }) => Promise<void>;
}) {
  const [position, setPosition] = useState("product-builder");
  const [label, setLabel] = useState("");
  // Herda a vigência do contrato por padrão; editável dentro dela.
  const [from, setFrom] = useState(contractFrom);
  const [to, setTo] = useState(contractTo ?? "");
  const [busy, setBusy] = useState(false);
  const valid =
    !!position && from >= contractFrom && (!contractTo || from <= contractTo) &&
    (!to || (to >= from && (!contractTo || to <= contractTo)));

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
              <Field.Control><PositionSelect value={position} onChange={setPosition} /></Field.Control>
            </Field>
            <Field name="label">
              <Field.Label>Rótulo (opcional)</Field.Label>
              <Field.Control><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex: Builder Backend" /></Field.Control>
            </Field>
            <Field.Row cols={2}>
              <Field name="from" required>
                <Field.Label>Início</Field.Label>
                <Field.Control>
                  <DatePicker value={from} onChange={setFrom} min={contractFrom} max={contractTo ?? undefined} />
                </Field.Control>
              </Field>
              <Field name="to">
                <Field.Label>Fim</Field.Label>
                <Field.Control>
                  <DatePicker value={to} onChange={setTo} min={from || contractFrom} max={contractTo ?? undefined} clearable placeholder="em aberto" />
                </Field.Control>
              </Field>
            </Field.Row>
            <ContractHint from={contractFrom} to={contractTo} />
          </FormBody>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              try { await onSubmit({ position, label, from, to }); }
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

function EditVagaDialog({
  vaga,
  contractFrom,
  contractTo,
  onClose,
  onSubmit,
}: {
  vaga: ContractVaga;
  contractFrom: string;
  contractTo: string | null;
  onClose: () => void;
  onSubmit: (v: { label: string; from: string; to: string }) => Promise<void>;
}) {
  const [label, setLabel] = useState(vaga.label ?? "");
  const [from, setFrom] = useState(vaga.effective_from);
  const [to, setTo] = useState(vaga.effective_to ?? "");
  const [busy, setBusy] = useState(false);
  const valid =
    from >= contractFrom && (!contractTo || from <= contractTo) &&
    (!to || (to >= from && (!contractTo || to <= contractTo)));

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Editar vaga · {positionLabel(vaga.position)}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Rótulo e datas de entrada/saída da função (a posição não muda — pra trocar, remova e crie).
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="py-4">
          <FormBody density="compact">
            <Field name="label">
              <Field.Label>Rótulo (opcional)</Field.Label>
              <Field.Control><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex: Builder Backend" /></Field.Control>
            </Field>
            <Field.Row cols={2}>
              <Field name="from" required>
                <Field.Label>Início</Field.Label>
                <Field.Control>
                  <DatePicker value={from} onChange={setFrom} min={contractFrom} max={contractTo ?? undefined} />
                </Field.Control>
              </Field>
              <Field name="to">
                <Field.Label>Fim</Field.Label>
                <Field.Control>
                  <DatePicker value={to} onChange={setTo} min={from || contractFrom} max={contractTo ?? undefined} clearable placeholder="em aberto" />
                </Field.Control>
              </Field>
            </Field.Row>
            <ContractHint from={contractFrom} to={contractTo} />
          </FormBody>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              try { await onSubmit({ label, from, to }); }
              catch (e) { showErrorToast(e, { label: "Falha ao editar vaga" }); }
              finally { setBusy(false); }
            }}
          >
            {busy ? "Salvando…" : "Salvar"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * Hard-delete guardado: apaga a vaga E a ocupação. Pra ERRO/DUPLICATA (não é
 * saída real → não vai pro histórico). Exige digitar DELETAR — guarda contra
 * apagar coisa real sem querer.
 */
function DeleteVagaDialog({
  role,
  occName,
  onClose,
  onConfirm,
}: {
  role: string;
  occName: string | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const armed = text.trim().toUpperCase() === "DELETAR";

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Deletar vaga · {role}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {occName
              ? `Apaga a vaga E a ocupação de ${occName} — o custo some e NÃO vai pro histórico.`
              : "Apaga a vaga de vez."}{" "}
            Use só pra erro/duplicata. Pra saída real, use Encerrar.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody className="py-4">
          <FormBody density="compact">
            <Field name="confirm" required>
              <Field.Label>Digite DELETAR para confirmar</Field.Label>
              <Field.Control>
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="DELETAR" autoComplete="off" />
              </Field.Control>
            </Field>
          </FormBody>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button
            variant="destructive"
            disabled={!armed || busy}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(); }
              catch (e) { showErrorToast(e, { label: "Falha ao deletar" }); }
              finally { setBusy(false); }
            }}
          >
            {busy ? "Deletando…" : "Deletar"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
