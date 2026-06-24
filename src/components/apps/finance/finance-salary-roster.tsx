"use client";

/**
 * Roster de salários — referência a despesa de pessoal de forma organizada:
 * lista TODOS os membros (internos e externos, em seções separadas) com o custo
 * mensal vigente (entry da categoria Salários sem effective_to), e permite
 * definir/atualizar/remover inline. Cada membro = 1 comp vigente.
 *
 * Usado dentro do drill da categoria Salários (finance-category-sheet).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FormBody } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { brlFromCents } from "@/lib/format-currency";
import { fmtDate } from "@/lib/date-utils";
import { positionLabel } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { EntriesResponse, EntryListItem, MemberRef } from "@/lib/finance/types";

function firstOfMonthISO(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

export function FinanceSalaryRoster({
  categoryId,
  members,
  onChanged,
}: {
  categoryId: string;
  members: MemberRef[];
  onChanged: () => void;
}) {
  const [entries, setEntries] = useState<EntryListItem[] | null>(null);
  const [editing, setEditing] = useState<{ memberId: string; amount: string; from: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/finance/entries?categoryId=${categoryId}`);
    const json = res.ok ? ((await res.json()) as EntriesResponse) : null;
    setEntries(json?.entries ?? []);
  }, [categoryId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refetch();
    })();
    return () => {
      cancelled = true;
      void cancelled;
    };
  }, [refetch]);

  // Comp vigente por membro = entry da categoria sem effective_to (mais recente).
  const activeByMember = useMemo(() => {
    const map = new Map<string, EntryListItem>();
    for (const e of entries ?? []) {
      if (!e.member_id || e.effective_to !== null) continue;
      const cur = map.get(e.member_id);
      if (!cur || (e.effective_from ?? "") > (cur.effective_from ?? "")) map.set(e.member_id, e);
    }
    return map;
  }, [entries]);

  const internal = useMemo(
    () => members.filter((m) => !m.isExternal).sort((a, b) => a.name.localeCompare(b.name)),
    [members],
  );
  const external = useMemo(
    () => members.filter((m) => m.isExternal).sort((a, b) => a.name.localeCompare(b.name)),
    [members],
  );

  const totalMonthly = useMemo(
    () => [...activeByMember.values()].reduce((s, e) => s + e.amount_cents, 0),
    [activeByMember],
  );
  const definedCount = activeByMember.size;

  function startEdit(memberId: string) {
    const cur = activeByMember.get(memberId);
    setEditing({
      memberId,
      amount: cur ? (cur.amount_cents / 100).toString() : "",
      from: cur?.effective_from ?? firstOfMonthISO(),
    });
  }

  async function save() {
    if (!editing) return;
    const amountCents = Math.round(parseFloat(editing.amount.replace(",", ".")) * 100);
    if (!(amountCents > 0) || !editing.from) return;
    const existing = activeByMember.get(editing.memberId);
    const payload = {
      categoryId,
      memberId: editing.memberId,
      projectId: null,
      amountCents,
      recurrence: "monthly" as const,
      effectiveFrom: editing.from,
      effectiveTo: null,
    };
    setSaving(true);
    try {
      await fetchOrThrow(
        existing ? `/api/finance/entries/${existing.id}` : "/api/finance/entries",
        {
          method: existing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      setEditing(null);
      await refetch();
      onChanged();
    } catch (e) {
      showErrorToast(e, { label: "Falha ao salvar salário" });
    } finally {
      setSaving(false);
    }
  }

  function remove(memberId: string, memberName: string) {
    const existing = activeByMember.get(memberId);
    if (!existing) return;
    setConfirm({
      title: "Remover salário?",
      description: `O custo mensal de ${memberName} será removido.`,
      destructive: true,
      confirmLabel: "Remover",
      onConfirm: async () => {
        try {
          await fetchOrThrow(`/api/finance/entries/${existing.id}`, { method: "DELETE" });
          await refetch();
          onChanged();
        } catch (e) {
          showErrorToast(e, { label: "Falha ao remover salário" });
        }
      },
    });
  }

  if (entries === null) {
    return <p className="px-1 py-8 text-center text-sm text-muted-foreground">carregando…</p>;
  }

  function renderRow(m: MemberRef) {
    const cur = activeByMember.get(m.id);
    const isEditing = editing?.memberId === m.id;
    return (
            <div key={m.id} className="group">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.position ? positionLabel(m.position) : "—"}
                    {cur ? ` · desde ${fmtDate(cur.effective_from!)}` : ""}
                  </p>
                </div>
                {cur ? (
                  <>
                    <span className="shrink-0 font-mono text-sm tabular-nums">
                      {brlFromCents(cur.amount_cents)}
                      <span className="text-muted-foreground">/mês</span>
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        title="Editar"
                        aria-label="Editar"
                        onClick={() => startEdit(m.id)}
                        className="rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Remover"
                        aria-label="Remover"
                        onClick={() => remove(m.id, m.name)}
                        className="rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-rose-500 group-hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn(!isEditing && "opacity-70")}
                    onClick={() => startEdit(m.id)}
                  >
                    Definir
                  </Button>
                )}
              </div>

              {isEditing && (
                <div className="border-t bg-muted/20 px-3 py-3">
                  <FormBody density="compact">
                    <Field.Row cols={2}>
                      <Field name="amount" required>
                        <Field.Label>Custo mensal (R$)</Field.Label>
                        <Field.Control>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={editing.amount}
                            onChange={(e) =>
                              setEditing((s) => (s ? { ...s, amount: e.target.value } : s))
                            }
                            placeholder="0,00"
                          />
                        </Field.Control>
                      </Field>
                      <Field name="from" required>
                        <Field.Label>Vigente desde</Field.Label>
                        <Field.Control>
                          <DatePicker
                            data-slot="button"
                            value={editing.from}
                            onChange={(iso) =>
                              setEditing((s) => (s ? { ...s, from: iso } : s))
                            }
                          />
                        </Field.Control>
                      </Field>
                    </Field.Row>
                  </FormBody>
                  <div className="mt-2 flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
                      Cancelar
                    </Button>
                    <Button size="sm" onClick={save} disabled={saving}>
                      {saving ? "Salvando…" : "Salvar"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
  }

  return (
    <div>
      <p className="mb-3 font-mono text-xs text-muted-foreground">
        <span className="text-foreground">{brlFromCents(totalMonthly)}</span>/mês ·{" "}
        {definedCount}/{members.length} com custo definido
      </p>

      <p className="px-1 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Internos · {internal.length}
      </p>
      <div className="surface divide-y divide-border/60 overflow-hidden">
        {internal.map(renderRow)}
      </div>

      {external.length > 0 && (
        <>
          <p className="mt-4 px-1 pb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Externos · {external.length}
          </p>
          <div className="surface divide-y divide-border/60 overflow-hidden">
            {external.map(renderRow)}
          </div>
        </>
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
