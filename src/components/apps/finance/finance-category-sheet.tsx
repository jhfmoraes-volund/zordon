"use client";

/**
 * Drill de categoria — side-sheet com os itens (finance.entry) da categoria
 * clicada. Cada item abre o detalhe pra editar; trash exclui (optimistic +
 * ConfirmDialog); "+ Adicionar" cria. Remontado por categoria via `key` no pai.
 */

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/ui/responsive-sheet";
import { AppFileList, AppFileRow, AppFileBadge } from "@/components/apps/app-file-list";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { fetchOrThrow } from "@/lib/optimistic/toast";
import { brlFromCents } from "@/lib/format-currency";
import { fmtDate } from "@/lib/date-utils";
import type {
  Category,
  CategoryTotal,
  EntriesResponse,
  EntryListItem,
  MemberRef,
  Recurrence,
} from "@/lib/finance/types";
import { FinanceEntryForm } from "./finance-entry-form";
import { FinanceSalaryRoster } from "./finance-salary-roster";

type NamedRef = { id: string; name: string };

const RECURRENCE_LABEL: Record<Recurrence, string> = {
  once: "pontual",
  monthly: "mensal",
  annual: "anual",
};

function periodLabel(e: EntryListItem): string {
  if (e.recurrence === "once") return e.occurred_on ? fmtDate(e.occurred_on) : "";
  const from = e.effective_from ? fmtDate(e.effective_from) : "";
  return `${from} → ${e.effective_to ? fmtDate(e.effective_to) : "atual"}`;
}

export function FinanceCategorySheet({
  open,
  onOpenChange,
  category,
  categories,
  projects,
  members,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  category: CategoryTotal;
  categories: Category[];
  projects: NamedRef[];
  members: MemberRef[];
  onChanged: () => void;
}) {
  const { items, setCommitted, mutate } = useOptimisticCollection<EntryListItem>([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [form, setForm] = useState<{ entry: EntryListItem | null; key: number } | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/finance/entries?categoryId=${category.categoryId}`);
    const json = res.ok ? ((await res.json()) as EntriesResponse) : null;
    setCommitted(json?.entries ?? []);
  }, [category.categoryId, setCommitted]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refetch();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refetch]);

  function handleDelete(item: EntryListItem) {
    setConfirm({
      title: "Excluir lançamento?",
      description: "A transação será removida permanentemente.",
      destructive: true,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        await mutate(
          { type: "delete", id: item.id },
          async () => {
            await fetchOrThrow(`/api/finance/entries/${item.id}`, { method: "DELETE" });
            return item.id;
          },
          { errorLabel: "Falha ao excluir lançamento" },
        );
        onChanged();
      },
    });
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent size="lg">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>{category.name}</ResponsiveSheetTitle>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          {category.slug === "salarios" ? (
            <FinanceSalaryRoster
              categoryId={category.categoryId}
              members={members}
              onChanged={onChanged}
            />
          ) : (
            <>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="font-mono text-xs text-muted-foreground">
              <span className="text-foreground">{brlFromCents(category.amountCents)}</span> no ano ·{" "}
              {items.length} {items.length === 1 ? "item" : "itens"}
            </p>
            <Button
              size="sm"
              onClick={() => setForm({ entry: null, key: Date.now() })}
            >
              <Plus className="size-3.5" /> Adicionar
            </Button>
          </div>

          {loading ? (
            <p className="px-1 py-8 text-center text-sm text-muted-foreground">carregando…</p>
          ) : items.length === 0 ? (
            <div className="rounded-md border px-3 py-8 text-center text-sm text-muted-foreground">
              Nenhum lançamento nesta categoria — adicione o primeiro.
            </div>
          ) : (
            <AppFileList>
              {items.map((e) => (
                <AppFileRow
                  key={e.id}
                  icon={Pencil}
                  iconClassName="opacity-0"
                  title={e.description || e.vendor || e.memberName || "Lançamento"}
                  subtitle={`${e.projectName ?? "Operação"} · ${periodLabel(e)}`}
                  badge={<AppFileBadge tone="muted">{RECURRENCE_LABEL[e.recurrence]}</AppFileBadge>}
                  meta={brlFromCents(e.amount_cents)}
                  onOpen={() => setForm({ entry: e, key: Date.now() })}
                  actions={
                    <>
                      <button
                        type="button"
                        title="Editar"
                        aria-label="Editar"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setForm({ entry: e, key: Date.now() });
                        }}
                        className="rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Excluir"
                        aria-label="Excluir"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          handleDelete(e);
                        }}
                        className="rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-rose-500 group-hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </>
                  }
                />
              ))}
            </AppFileList>
          )}
            </>
          )}
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>

      {form && (
        <FinanceEntryForm
          key={form.key}
          open
          onOpenChange={(o) => {
            if (!o) setForm(null);
          }}
          kind={category.kind}
          categories={categories}
          projects={projects}
          members={members}
          entry={form.entry}
          presetCategoryId={category.categoryId}
          onSaved={() => {
            void refetch();
            onChanged();
          }}
        />
      )}

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </ResponsiveSheet>
  );
}
