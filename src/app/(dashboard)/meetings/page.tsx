"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Eye, Link2, Lock, Pencil, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ConfirmDialog,
  type ConfirmState,
} from "@/components/ui/confirm-dialog";
import { useOptimisticCollection } from "@/hooks/use-optimistic-collection";
import { fetchOrThrow } from "@/lib/optimistic/toast";
import {
  MeetingSheet,
  type MeetingEditInitial,
} from "@/components/meetings/meeting-sheet";
import { fmtWeekdayShort as fmtDate } from "@/lib/date-utils";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Reunião = EVENTO. Visibility (private|public) GOVERNA acesso; kind é rótulo.
type Visibility = "private" | "public";

const KIND_LABELS: Record<string, string> = {
  one_on_one: "1:1",
  general: "Geral",
  external: "Externa",
  sync: "Sync",
  // rótulos legados (pré-migração pra Cerimônias) ainda aparecem:
  pm_review: "PMs",
  daily: "Daily",
  planning: "Planning",
};

type Meeting = {
  id: string;
  date: string;
  notes: string | null;
  visibility: Visibility;
  kind: string;
  title: string | null;
  createdById: string | null;
  actionItems: { id: string; status: string }[];
  attendees: {
    id: string;
    memberId: string | null;
    member: { id: string; name: string } | null;
    externalName: string | null;
  }[];
  projectLinks: { project: { id: string; name: string } | null }[];
};

// "shared" não é uma visibilidade — é um recorte: reuniões que eu vejo mas
// não criei (alguém me adicionou). Ortogonal a private/public.
type FilterKey = "all" | Visibility | "shared";

const VIS_FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "public", label: "Públicas" },
  { key: "private", label: "Privadas" },
  { key: "shared", label: "Compartilhadas" },
];

export default function MeetingsPage() {
  const { member: currentMember, effectiveAccessLevel } = useAuth();
  const isBuilder = effectiveAccessLevel === "builder";
  // Qualquer membro edita reuniões que criou; manager+ edita tudo.
  const canEditRow = (m: Meeting): boolean => {
    if (!isBuilder) return true;
    return !!currentMember && m.createdById === currentMember.id;
  };

  const collection = useOptimisticCollection<Meeting>([]);
  const meetings = collection.items;
  const setMeetings = collection.setCommitted;
  const mutate = collection.mutate;

  const [loading, setLoading] = useState(true);
  const [visFilter, setVisFilter] = useState<FilterKey>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<MeetingEditInitial | null>(null);

  const openCreate = () => {
    setSheetMode("create");
    setEditing(null);
    setSheetOpen(true);
  };

  const openEdit = (m: Meeting) => {
    setSheetMode("edit");
    setEditing({
      id: m.id,
      visibility: m.visibility,
      kind: m.kind ?? "general",
      date: m.date,
      title: m.title,
      notes: m.notes,
      attendees: m.attendees.map((a) => ({
        memberId: a.memberId ?? a.member?.id ?? null,
        externalName: a.externalName ?? null,
        externalEmail: null,
        externalRole: null,
        role: null,
      })),
      projectLinks: m.projectLinks.map((l) => ({
        project: l.project ? { id: l.project.id } : null,
      })),
    });
    setSheetOpen(true);
  };

  const load = async () => {
    try {
      const r = await fetch("/api/meetings");
      if (!r.ok) {
        setMeetings([]);
        return;
      }
      setMeetings((await r.json()) as Meeting[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = (m: Meeting) => {
    setConfirmState({
      title: "Remover esta reunião?",
      description: m.title
        ? `"${m.title}" e seus dados serão removidos.`
        : "A reunião e seus dados serão removidos.",
      confirmLabel: "Remover",
      destructive: true,
      onConfirm: async () => {
        const ok = await mutate(
          { type: "delete", id: m.id },
          async (signal) => {
            const res = await fetchOrThrow(`/api/meetings/${m.id}`, {
              method: "DELETE",
              signal,
            });
            return (await res.json().catch(() => ({}))) as { ok?: true };
          },
          {
            errorLabel: "Falha ao remover reunião",
            reconcile: (prev) => prev.filter((x) => x.id !== m.id),
          },
        );
        if (ok) toast.success("Reunião removida.");
      },
    });
  };

  // Rótulos (kind) presentes nas reuniões — alimenta o filtro secundário.
  const kindOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of meetings) set.add(m.kind);
    return Array.from(set);
  }, [meetings]);

  // Compartilhada comigo = vejo (GET já filtrou por acesso) mas não criei.
  const isSharedWithMe = (m: Meeting): boolean =>
    !!currentMember && m.createdById !== currentMember.id;

  const counts = useMemo(() => {
    let pub = 0;
    let priv = 0;
    let shared = 0;
    for (const m of meetings) {
      if (m.visibility === "public") pub += 1;
      else priv += 1;
      if (isSharedWithMe(m)) shared += 1;
    }
    return { all: meetings.length, public: pub, private: priv, shared };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings, currentMember]);

  const visible = useMemo(() => {
    return meetings.filter((m) => {
      if (visFilter === "shared") {
        if (!isSharedWithMe(m)) return false;
      } else if (visFilter !== "all" && m.visibility !== visFilter) {
        return false;
      }
      if (kindFilter !== "all" && m.kind !== kindFilter) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetings, visFilter, kindFilter, currentMember]);

  return (
    <PageContainer>
      <div className="space-y-6">
        <PageHeader
          title="Reuniões"
          description="Reuniões privadas e públicas. Cerimônias de projeto vivem no próprio projeto."
          onAdd={openCreate}
          addLabel="Nova reunião"
        />

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Filtrar por visibilidade"
          className="inline-flex rounded-md border bg-muted/30 p-0.5 text-sm"
        >
          {VIS_FILTERS.map((f) => {
            const active = visFilter === f.key;
            return (
              <button
                key={f.key}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setVisFilter(f.key)}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
                <span className="ml-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                  {counts[f.key]}
                </span>
              </button>
            );
          })}
        </div>

        {kindOptions.length > 1 && (
          <div
            role="tablist"
            aria-label="Filtrar por tipo"
            className="inline-flex flex-wrap rounded-md border bg-muted/30 p-0.5 text-sm"
          >
            <button
              type="button"
              role="tab"
              aria-selected={kindFilter === "all"}
              onClick={() => setKindFilter("all")}
              className={cn(
                "rounded-sm px-2.5 py-1 text-xs transition-colors",
                kindFilter === "all"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Todos
            </button>
            {kindOptions.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kindFilter === k}
                onClick={() => setKindFilter(k)}
                className={cn(
                  "rounded-sm px-2.5 py-1 text-xs transition-colors",
                  kindFilter === k
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {KIND_LABELS[k] ?? k}
              </button>
            ))}
          </div>
        )}
      </div>

      <MeetingSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        mode={sheetMode}
        meeting={editing}
        onSaved={() => load()}
      />

      <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="surface flex items-center gap-3 p-3">
              <Skeleton className="size-6 rounded-md" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="surface py-12 text-center text-sm text-muted-foreground">
          {visFilter === "shared"
            ? "Nenhuma reunião compartilhada com você."
            : visFilter === "public"
              ? "Nenhuma reunião pública."
              : visFilter === "private"
                ? "Nenhuma reunião privada."
                : "Nenhuma reunião."}
        </div>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {visible.map((m) => {
            const pending = m.actionItems.filter(
              (a) => a.status !== "done",
            ).length;
            const isPrivate = m.visibility === "private";
            return (
              <li
                key={m.id}
                className="group flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-accent/40 focus-within:bg-accent/40"
              >
                <span
                  aria-hidden
                  title={isPrivate ? "Privada — só o dono" : "Pública — quem participou"}
                  className={cn(
                    "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md",
                    isPrivate
                      ? "bg-muted text-muted-foreground"
                      : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                  )}
                >
                  {isPrivate ? (
                    <Lock className="size-3" />
                  ) : (
                    <Eye className="size-3" />
                  )}
                </span>

                <Link
                  href={`/meetings/${m.id}`}
                  className="min-w-0 flex-1 focus-visible:outline-none"
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                    <p
                      className={cn(
                        "line-clamp-3 min-w-0 text-sm font-medium sm:line-clamp-1",
                        !m.title && "text-muted-foreground",
                      )}
                    >
                      {m.title || "Sem título"}
                    </p>
                    <div className="flex items-center gap-2 sm:min-w-0 sm:flex-1">
                      <span className="shrink-0 rounded-sm border bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                        {KIND_LABELS[m.kind] ?? m.kind}
                      </span>
                      {pending > 0 && (
                        <span className="shrink-0 text-[10px] font-medium text-amber-700 dark:text-amber-500">
                          ⚠ {pending} pendente{pending > 1 ? "s" : ""}
                        </span>
                      )}
                      <span className="ml-auto hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
                        {fmtDate(m.date)}
                      </span>
                    </div>
                  </div>

                  {m.projectLinks.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Link2 className="size-3 text-muted-foreground" />
                      {m.projectLinks.map((l, i) =>
                        l.project ? (
                          <span
                            key={i}
                            className="rounded-sm border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-300"
                          >
                            {l.project.name}
                          </span>
                        ) : null,
                      )}
                    </div>
                  )}
                </Link>

                {canEditRow(m) && (
                  <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground"
                      aria-label="Editar reunião"
                      title="Editar"
                      onClick={() => openEdit(m)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive"
                      aria-label="Remover reunião"
                      title="Remover"
                      onClick={() => remove(m)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      </div>
    </PageContainer>
  );
}
